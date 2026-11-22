"""Revision edge proxy on Modal — the InferHub key never reaches the browser.

Why Modal: no usable Cloudflare/Vercel token on the machines, and Modal is
already configured here. **CPU only, no GPU**: this proxy only relays JSON.

Deployment:
    modal deploy proxy/modal_app.py
Secret (created once):
    modal secret create inferhub-key --from-json cle.json

What this proxy does beyond a simple relay (ideas 2, 5 and 9 from the "stay on
InferHub" brainstorm):

1. **Server-side fallback chain**: InferHub is a marketplace where 5 out of 6
   vision models can be in 503 at the same moment. The client no longer has to
   make a round trip per dead model — the proxy walks the chain, saving 1 to 5
   HTTP round trips per analysis.
2. **Per-model circuit breaker**: a 402/503 puts the model in a 60 s cooldown,
   so we do not pay 1 to 2 s per already-dead model on every analysis.
3. **Configurable auctions**: if `REVISION_MAX_IN_PRICE` / `REVISION_MAX_OUT_PRICE`
   are set, the `x-max-input-price` / `x-max-output-price` headers are forwarded.
   Without them, only models included in the account preferences answer (the
   others return 402).

Contract: POST /analyze {model, messages, …} → 200 {"texte": …, "modele": …}.
The `x-revision-cle` header (BYOK) replaces the server key when provided.
If the whole chain fails: 503 {"erreur": …, "chaineEpuisee": true} — the client
then stops instead of replaying its own chain.

Log: timestamp, status, latency, model. Never the image, never the extracted
text, never the key, never the raw IP (RNF-P3).
"""

import json
import os
import time

import modal

APP_NOM = "revision-proxy"
AMONT_DEFAUT = "https://api.inferhub.dev/v1"
TAILLE_MAX_OCTETS = 15 * 1024 * 1024
DELAI_AMONT_S = 90.0

# Server fallback chain. Keep it aligned with CHAINE_MODELES in
# src/domain/config.ts: the client starts with its preferred model, the proxy
# finishes the job.
CHAINE = [
    "ag/gemini-4-carbon",
    "ag/claude-sonnet-4-6",
    "ag/gemini-4-argon",
    "ag/claude-sonnet-5-5",
    "ag/gemini-3.8-flash-high",
    "zai/glm-4.6v",
    "ag/claude-opus-4-6-thinking",
]
# 402 (out of auction) and 503 (no capacity) are transient but costly:
# a short cooldown so they are not retried on every analysis.
REESSAYABLES = {402, 429, 500, 502, 503, 504}
COOLDOWN_S = 60

ORIGINES = [
    "https://gaiasg94.github.io",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

MAX_CONTENEURS = 4
PAR_IP_PAR_HEURE = 20 // MAX_CONTENEURS      # 5 per container → ~20/hour/visitor
GLOBAL_PAR_JOUR = 400 // MAX_CONTENEURS      # 100 per container → ~400/day

image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "fastapi==0.115.*",
    "httpx==0.27.*",
)

app = modal.App(APP_NOM)


def _creer_quota():
    """In-memory sliding window: {id: [timestamps]} + daily counter."""
    historique: dict[str, list[float]] = {}
    etat = {"jour": 0.0, "utilise": 0}

    def autoriser(cle: str, maintenant: float) -> bool:
        if maintenant - etat["jour"] >= 86_400:
            etat["jour"] = maintenant
            etat["utilise"] = 0
        fenetre = [t for t in historique.get(cle, []) if maintenant - t < 3600]
        if len(fenetre) >= PAR_IP_PAR_HEURE or etat["utilise"] >= GLOBAL_PAR_JOUR:
            historique[cle] = fenetre
            return False
        fenetre.append(maintenant)
        historique[cle] = fenetre
        etat["utilise"] += 1
        return True

    return autoriser


def _creer_disjoncteur():
    """Per-model cooldown: a failing model is not retried for 60 s."""
    hors_service: dict[str, float] = {}

    def disponible(modele: str, maintenant: float) -> bool:
        return hors_service.get(modele, 0.0) <= maintenant

    def signaler(modele: str, maintenant: float, panne: bool) -> None:
        if panne:
            hors_service[modele] = maintenant + COOLDOWN_S
        else:
            hors_service.pop(modele, None)

    def etat() -> dict[str, float]:
        return {m: round(t - time.time(), 1) for m, t in hors_service.items() if t > time.time()}

    return disponible, signaler, etat


def _empreinte(ip: str) -> str:
    """IP fingerprint for the quota: never the raw IP in the logs."""
    h = 0
    for caractere in ip:
        h = (h * 31 + ord(caractere)) & 0xFFFFFFFF
    return "v%08x" % h


def _chaine_pour(modele_demande: str) -> list[str]:
    """Requested model first, then the rest of the chain, without duplicates."""
    demande = (modele_demande or "").strip()
    if not demande:
        return list(CHAINE)
    return [demande] + [m for m in CHAINE if m != demande]


def _entetes_amont(cle: str) -> dict[str, str]:
    entetes = {"content-type": "application/json", "authorization": "Bearer " + cle}
    prix_in = os.environ.get("REVISION_MAX_IN_PRICE", "").strip()
    prix_out = os.environ.get("REVISION_MAX_OUT_PRICE", "").strip()
    if prix_in:
        entetes["x-max-input-price"] = prix_in
    if prix_out:
        entetes["x-max-output-price"] = prix_out
    return entetes


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("inferhub-key")],
    cpu=0.25,
    memory=256,
    scaledown_window=60,
    max_containers=MAX_CONTENEURS,
)
@modal.asgi_app()
def analyze():
    """ASGI entry point: FastAPI mounted in the Modal container."""
    from fastapi import FastAPI, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse

    web = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    web.add_middleware(
        CORSMiddleware,
        allow_origins=ORIGINES,
        # GET for the probes (/health, /modeles) called from the browser.
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["content-type", "x-revision-cle"],
        max_age=600,
    )
    autoriser = _creer_quota()
    disponible, signaler, etat_disjoncteur = _creer_disjoncteur()
    amont = os.environ.get("REVISION_AMONT", AMONT_DEFAUT)

    @web.get("/health")
    async def health():
        return {"ok": True, "service": APP_NOM, "disjoncteur": etat_disjoncteur()}

    @web.get("/modeles")
    async def modeles():
        """Server chain + circuit breaker state: useful for diagnostics, with no key exposed."""
        return {"chaine": CHAINE, "disjoncteur": etat_disjoncteur(), "amont": amont}

    @web.post("/analyze")
    async def analyser(request: Request):
        debut = time.time()
        cle = request.headers.get("x-revision-cle", "").strip() or os.environ.get("INFERHUB_API_KEY", "")
        if not cle:
            return JSONResponse({"erreur": "Proxy not configured."}, status_code=503)

        ip = request.headers.get("x-forwarded-for", "inconnu").split(",")[0].strip()
        if not autoriser(_empreinte(ip), time.time()):
            return JSONResponse(
                {"erreur": "Proxy quota reached for this hour. Try again later.", "quota": "proxy"},
                status_code=429,
            )

        corps = await request.body()
        if len(corps) > TAILLE_MAX_OCTETS:
            return JSONResponse({"erreur": "Photo too large (15 MB max after encoding)."}, status_code=413)

        try:
            charge = json.loads(corps)
        except ValueError:
            _journal(400, debut, "-")
            return JSONResponse({"erreur": "Invalid JSON body."}, status_code=400)

        if charge.get("stream") is True:
            return await _relayer_en_flux(
                charge, cle, amont, debut, disponible, signaler, JSONResponse
            )
        return await _relayer_avec_chaine(charge, cle, amont, debut, disponible, signaler, JSONResponse)

    return web


async def _relayer_avec_chaine(charge, cle, amont, debut, disponible, signaler, JSONResponse):
    """Walks the model chain server-side, circuit breaker included."""
    import httpx

    demande = str(charge.get("model") or "")
    derniere_erreur = "no model available"
    dernier_statut = 503
    tentes = 0

    async with httpx.AsyncClient(timeout=DELAI_AMONT_S) as client:
        for modele in _chaine_pour(demande):
            if not disponible(modele, time.time()):
                continue
            tentes += 1
            charge["model"] = modele
            try:
                reponse = await client.post(
                    f"{amont}/chat/completions",
                    content=json.dumps(charge),
                    headers=_entetes_amont(cle),
                )
            except httpx.HTTPError:
                signaler(modele, time.time(), True)
                derniere_erreur, dernier_statut = "Upstream unreachable or too slow.", 504
                continue

            if reponse.status_code == 200:
                signaler(modele, time.time(), False)
                texte = _extraire_texte(reponse.text)
                if not texte:
                    _journal(502, debut, modele)
                    return JSONResponse({"erreur": "Empty response from the model."}, status_code=502)
                _journal(200, debut, modele, tentes)
                return JSONResponse(
                    {"texte": texte, "modele": modele, "tentatives": tentes},
                    headers={"cache-control": "no-store"},
                )

            signaler(modele, time.time(), reponse.status_code in REESSAYABLES)
            dernier_statut = reponse.status_code
            derniere_erreur = _message_amont(reponse.text)
            if reponse.status_code not in REESSAYABLES:
                break

    _journal(dernier_statut, debut, demande, tentes)
    return JSONResponse(
        {"erreur": derniere_erreur, "chaineEpuisee": True, "tentatives": tentes},
        status_code=dernier_statut,
    )


async def _relayer_en_flux(charge, cle, amont, debut, disponible, signaler, JSONResponse):
    """SSE streaming (idea 7): while the upstream thinks, we publish what is
    happening — "model 2/6: 503, trying next". Waiting becomes a demonstration
    of robustness instead of a silent spinner.

    The format is deliberately simple: `progres` events then a `resultat`
    event. A client that does not speak SSE falls back to the classic JSON path
    (the `/analyze` endpoint stays compatible).
    """
    import httpx
    from fastapi.responses import StreamingResponse

    demande = str(charge.get("model") or "")
    charge.pop("stream", None)

    async def generateur():
        derniere_erreur = "no model available"
        dernier_statut = 503
        tentes = 0
        async with httpx.AsyncClient(timeout=DELAI_AMONT_S) as client:
            for modele in _chaine_pour(demande):
                if not disponible(modele, time.time()):
                    continue
                tentes += 1
                charge["model"] = modele
                try:
                    reponse = await client.post(
                        f"{amont}/chat/completions",
                        content=json.dumps(charge),
                        headers=_entetes_amont(cle),
                    )
                except httpx.HTTPError:
                    signaler(modele, time.time(), True)
                    derniere_erreur, dernier_statut = "Upstream unreachable or too slow.", 504
                    yield _evenement("progres", {"modele": modele, "statut": 504, "essai": tentes})
                    continue

                if reponse.status_code == 200:
                    signaler(modele, time.time(), False)
                    texte = _extraire_texte(reponse.text)
                    if not texte:
                        yield _evenement("progres", {"modele": modele, "statut": 502, "essai": tentes})
                        continue
                    _journal(200, debut, modele, tentes)
                    yield _evenement(
                        "resultat", {"texte": texte, "modele": modele, "tentatives": tentes}
                    )
                    return

                signaler(modele, time.time(), reponse.status_code in REESSAYABLES)
                dernier_statut = reponse.status_code
                derniere_erreur = _message_amont(reponse.text)
                yield _evenement(
                    "progres",
                    {"modele": modele, "statut": reponse.status_code, "essai": tentes},
                )
                if reponse.status_code not in REESSAYABLES:
                    break
        _journal(dernier_statut, debut, demande, tentes)
        yield _evenement("erreur", {"erreur": derniere_erreur, "statut": dernier_statut})

    return StreamingResponse(
        generateur(),
        media_type="text/event-stream",
        headers={"cache-control": "no-store", "x-accel-buffering": "no"},
    )


def _evenement(nom: str, donnees: dict) -> str:
    """An SSE event: `event: name` then `data: {...}`."""
    return "event: %s\ndata: %s\n\n" % (nom, json.dumps(donnees, ensure_ascii=False))


def _message_amont(corps: str) -> str:
    """Readable error message, without revealing the key or the upstream."""
    try:
        return str(json.loads(corps).get("error", {}).get("message", "Upstream unavailable."))[:200]
    except (ValueError, AttributeError):
        return "Upstream unavailable."


def _extraire_texte(corps: str) -> str:
    try:
        data = json.loads(corps)
        return data["choices"][0]["message"].get("content") or ""
    except (ValueError, KeyError, IndexError, TypeError):
        return ""


def _journal(statut: int, debut: float, modele: str, tentatives: int = 0) -> None:
    """Only allowed log: timestamp, status, latency, model, attempts."""
    print(
        "%s %d %dms model=%s attempts=%d"
        % (time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), statut, (time.time() - debut) * 1000, modele, tentatives)
    )
