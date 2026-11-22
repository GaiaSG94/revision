/**
 * Demo corpus recorder — captures real model responses on several corpus papers
 * and writes them to `corpus/reponses/`.
 *
 * Why: the public demo has no key, and the upstream may be slow or out of
 * capacity on judging day. The product replays these responses — this is the
 * "response cache on the demo corpus" planned in the risk table (§24).
 * Everything is replayed **raw**: the zod parsers really do the work.
 *
 * Several papers are recorded so that ALL product features are visible offline:
 * two different error types (profile + trajectory) and a powers paper (teacher
 * mode, class statistic).
 *
 * Skipped without a key. Run with:
 *   INFERHUB_API_KEY=… npx vitest run tests/live/enregistrer-demo.test.ts
 *
 * ⚠ Any change to the call structure (merging, second pass, guardrail) requires
 * **recapturing** this corpus: otherwise the demo replays an old format and the
 * parser sends everything to E99 (bug of 11/11, see tests/demo.test.ts).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { construireDiagnostic } from '../../src/domain/diagnostic'
import { MODELE_PAR_DEFAUT } from '../../src/domain/config'
import { analyserImage } from '../../src/pipeline/analyse'
import type { ClientBrut } from '../../src/pipeline/client'
import { genererExerciceVerifie } from '../../src/pipeline/exercise'
import { revoirFautesPeuSures } from '../../src/pipeline/revue'
import type { RequeteLLM, Transport } from '../../src/pipeline/llm'
import { chaineModeles, construireCorps } from '../../src/pipeline/llm'

const CLE = process.env.INFERHUB_API_KEY ?? ''
const AMONT = process.env.REVISION_AMONT ?? 'https://api.inferhub.dev/v1'
/**
 * Proxy mode: the key lives on the Worker (never here). We then go through the
 * edge proxy, which walks the model chain itself. Without a key and without a
 * proxy, the recorder does not run.
 */
const PROXY = process.env.REVISION_PROXY_URL ?? ''
const MODE_PROXY = PROXY !== '' && CLE === ''
const DELAI_MS = 240_000
const transport: Transport = MODE_PROXY
  ? { proxy: PROXY }
  : { proxy: `${AMONT}/chat/completions` }

/**
 * Papers recorded for the demo: read from `corpus/demo/` (the student's
 * "photos"), each producing a response file with the same name.
 */
const DOSSIER_DEMO = '../../corpus/demo'
/** All demo photo papers (see corpus/copies-demo.json). */
const TOUTES_COPIES = [
  'copie-demo-1.jpg',
  'copie-demo-2.jpg',
  'copie-demo-3.jpg',
  'copie-demo-4.jpg',
  'copie-demo-5.jpg',
  'copie-demo-6.jpg',
  'v2-copie-1.jpg',
  'v2-copie-2.jpg',
  'v2-copie-3.jpg',
  'v2-copie-4.jpg',
]
/** Subset to record: `RECORD_COPIES=v2-copie-1,v2-copie-2`. */
const COPIES_DEMO = process.env.RECORD_COPIES
  ? TOUTES_COPIES.filter((nom) =>
      process.env.RECORD_COPIES!.split(',')
        .map((entree) => entree.trim().replace(/\.(png|jpg)$/, ''))
        .includes(nom.replace(/\.(png|jpg)$/, '')),
    )
  : TOUTES_COPIES

async function appeler(requete: RequeteLLM, modele: string): Promise<string> {
  const reponse = await fetch(`${AMONT}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${CLE}` },
    body: JSON.stringify(construireCorps(requete, modele)),
    signal: AbortSignal.timeout(DELAI_MS),
  })
  if (!reponse.ok) {
    throw Object.assign(new Error(`upstream HTTP ${reponse.status}`), { statut: reponse.status })
  }
  const data = (await reponse.json()) as { choices?: { message?: { content?: string } }[] }
  return data.choices?.[0]?.message?.content ?? ''
}

/** A call to the edge proxy: the key stays server-side. */
async function appelerProxy(requete: RequeteLLM, modele: string): Promise<{ texte: string; modele: string }> {
  const reponse = await fetch(PROXY, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://gaiasg94.github.io' },
    body: JSON.stringify(construireCorps(requete, modele)),
    signal: AbortSignal.timeout(DELAI_MS),
  })
  const data = (await reponse.json()) as { texte?: string; modele?: string; erreur?: string }
  if (!reponse.ok) {
    throw Object.assign(new Error(data.erreur ?? `proxy HTTP ${reponse.status}`), {
      statut: reponse.status,
    })
  }
  return { texte: data.texte ?? '', modele: data.modele ?? modele }
}

const TRANSITOIRES = new Set([402, 429, 500, 502, 503, 504])
const ESSAIS_PROXY = 6
const PAUSE_PROXY_MS = 12_000
/**
 * Models tried in rotation when the proxy is used: a model may answer outside
 * JSON (response rejected by the zod parser). Rotating the list avoids getting
 * stuck on a chatty model.
 */
const MODELES_TENTATION = [
  'ag/gemini-4-carbon',
  'ag/claude-sonnet-4-6',
  'ag/gemini-4-argon',
  'ag/claude-sonnet-5-5',
]

/** A JSON response is expected: without braces, the parser will reject it. */
function estJson(texte: string): boolean {
  return texte.includes('{') && texte.includes('}')
}

/** Real client with chain fallback, recording every raw response. */
function clientEnregistreur(brut: Record<string, string>, cle: string): ClientBrut {
  if (MODE_PROXY) {
    // The proxy already walks the chain: retry the whole proxy, with a pause
    // (a dead model is marked for 60 s by the Worker). The last good response
    // overwrites the previous ones: an out-of-JSON response does not remain.
    return async (requete: RequeteLLM) => {
      let derniere = 'proxy unavailable'
      for (let essai = 0; essai < ESSAIS_PROXY; essai += 1) {
        const modele = MODELES_TENTATION[essai % MODELES_TENTATION.length]!
        try {
          const { texte, modele: repondant } = await appelerProxy(requete, modele)
          if (!estJson(texte)) throw new Error(`response outside JSON (${repondant})`)
          brut[cle] = texte
          modelesRepondus.add(repondant)
          return texte
        } catch (erreur) {
          derniere = (erreur as Error).message
          const statut = (erreur as { statut?: number }).statut ?? 0
          if (!TRANSITOIRES.has(statut) && !(erreur as Error).message.includes('outside JSON')) throw erreur
          await new Promise((r) => setTimeout(r, PAUSE_PROXY_MS))
        }
      }
      throw new Error(derniere)
    }
  }
  return async (requete: RequeteLLM) => {
    let derniere = 'no model available'
    for (const modele of chaineModeles(transport)) {
      try {
        const texte = await appeler(requete, modele)
        brut[cle] = texte
        modelesRepondus.add(modele)
        return texte
      } catch (erreur) {
        if (!TRANSITOIRES.has((erreur as { statut?: number }).statut ?? 0)) throw erreur
        derniere = (erreur as Error).message
      }
    }
    throw new Error(derniere)
  }
}

/** One step, replayed up to 5 times: an out-of-JSON response or a 503 does not kill the recording. */
async function avecReprise<T>(nom: string, travail: () => Promise<T>): Promise<T> {
  let derniere: Error | null = null
  for (let essai = 0; essai < 5; essai += 1) {
    try {
      return await travail()
    } catch (erreur) {
      derniere = erreur instanceof Error ? erreur : new Error(String(erreur))
      console.info(`[demo] ${nom}: attempt ${essai + 1} failed (${derniere.message}), retrying…`)
      await new Promise((r) => setTimeout(r, PAUSE_PROXY_MS))
    }
  }
  throw derniere ?? new Error('failure without a message')
}

/** Models that actually answered during recording. */
const modelesRepondus = new Set<string>()


function imageDataUrl(nom: string): string {
  const chemin = fileURLToPath(new URL(`${DOSSIER_DEMO}/${nom}`, import.meta.url))
  const octets = readFileSync(chemin)
  const type = nom.endsWith('.jpg') ? 'image/jpeg' : 'image/png'
  return `data:${type};base64,${octets.toString('base64')}`
}

function cheminSortie(nom: string): string {
  const base = nom.replace(/\.(png|jpg)$/, '.json')
  return fileURLToPath(new URL(`../../corpus/reponses/${base}`, import.meta.url))
}

/** Runs the product's real path on a paper and writes the responses. */
async function enregistrer(nom: string) {
  const brut: Record<string, string> = {}
  // Real durations of each step are captured: the demo will replay that pace
  // instead of being instantaneous (and therefore implausible).
  const durees: Record<string, number> = {}
  const chrono = async <T>(etape: string, nom: string, travail: () => Promise<T>): Promise<T> => {
    const debut = Date.now()
    const resultat = await avecReprise(nom, travail)
    durees[etape] = Date.now() - debut
    return resultat
  }
  const { extraction, erreurs } = await chrono('extrait', nom, () =>
    analyserImage(imageDataUrl(nom), transport, clientEnregistreur(brut, 'analyse')),
  )
  const revue = await chrono('classifie', nom, () =>
    revoirFautesPeuSures(erreurs, transport, clientEnregistreur(brut, 'revue')),
  )
  const diagnostic = construireDiagnostic(revue.erreurs, { id: nom, createdAt: new Date().toISOString() })
  // A paper with no error has no dominant type: this is an expected result
  // ("no errors detected"), not a recording failure.
  const propre = extraction.copiePropre
  if (!propre) expect(diagnostic.typeDominant, `${nom}: no dominant type`).toBeTruthy()

  if (!propre) {
    await chrono('genere', nom, () =>
      genererExerciceVerifie({
        typeDominant: diagnostic.typeDominant!,
        extraitCopie: extraction.annotations.map((a) => a.ligne).slice(0, 6).join('\n'),
        transport,
        client: async (requete: RequeteLLM) => {
          // The marker must follow the current prompt ("Relevance guardrail"),
          // as in `etapeDe` of src/pipeline/demo.ts.
          const cle = requete.system.includes('Relevance guardrail') ? 'verdict' : 'exercice'
          return clientEnregistreur(brut, cle)(requete)
        },
      }),
    )
  }

  mkdirSync(fileURLToPath(new URL('../../corpus/reponses/', import.meta.url)), { recursive: true })
  writeFileSync(
    cheminSortie(nom),
    `${JSON.stringify(
      {
        source: `corpus/demo/${nom}`,
        modele: [...modelesRepondus].join(', ') || MODELE_PAR_DEFAUT,
        enregistreLe: new Date().toISOString(),
        dominant: propre ? 'propre' : diagnostic.typeDominant,
        nbFautes: propre ? 0 : diagnostic.nbFautes,
        revues: revue.revues,
        durees,
        reponses: brut,
      },
      null,
      2,
    )}\n`,
  )
  return { nom, dominant: propre ? 'propre' : diagnostic.typeDominant, revues: revue.revues }
}

describe.skipIf(!CLE && !MODE_PROXY)('demo corpus recording', () => {
  for (const nom of COPIES_DEMO) {
    it(
      `captures analysis, review, exercise and verdict for ${nom}`,
      async () => {
        const resultat = await enregistrer(nom)
        console.info(`[demo] ${resultat.nom} → dominant ${resultat.dominant}, reviews ${resultat.revues}`)
        const contenu = JSON.parse(readFileSync(cheminSortie(nom), 'utf8')) as {
          dominant: string
          reponses: Record<string, string>
        }
        expect(contenu.reponses.analyse).toBeTruthy()
        // A clean paper has neither exercise nor verdict: the pipeline stops
        // before, and this is the expected result ("no errors detected").
        if (contenu.dominant === 'propre') {
          expect(contenu.reponses.exercice).toBeUndefined()
          return
        }
        expect(contenu.reponses.exercice).toBeTruthy()
        expect(contenu.reponses.verdict).toBeTruthy()
      },
      DELAI_MS * 8,
    )
  }
})