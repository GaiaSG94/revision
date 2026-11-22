/**
 * Demo mode — replays responses **really recorded** from the model on the
 * corpus papers (`corpus/reponses/*.json`, captured by
 * `tests/live/enregistrer-demo.test.ts`).
 *
 * Purpose: the public demo has no key, and the upstream may be slow or out of
 * capacity on judging day. The whole product remains demonstrable offline —
 * including teacher mode and the profile trajectory, which need several papers.
 * The zod parsers work on real model JSON; nothing is short-circuited.
 *
 * Available papers are discovered at build time (`import.meta.glob`): adding a
 * recording in `corpus/reponses/` extends the demo without touching the code.
 *
 * Honesty: the UI displays "recorded responses" when this mode is running.
 */
import { libelleDe } from '../domain/taxonomy'
import type { CodeErreur } from '../domain/taxonomy'
import type { ClientBrut } from './client'
import type { RequeteLLM } from './llm'
import descriptionDemo from '../../corpus/copies-demo.json'

export type EtapeDemo = 'analyse' | 'revue' | 'exercice' | 'verdict'

type Enregistrement = {
  source: string
  modele: string
  enregistreLe: string
  dominant: string
  /** Absent from recordings before 12/11: tolerated. */
  nbFautes?: number
  revues?: number
  /** Real durations measured during recording, replayed by the demo. */
  durees?: Record<string, number>
  reponses: Record<string, string>
}

export type CopieDemo = {
  id: string
  titre: string
  image: string
  enregistrement: Enregistrement
}

/**
 * A sample: a paper photo the user can try. It may not have recorded responses
 * — without them, the analysis goes through the online model (the edge proxy);
 * with them, it replays offline.
 */
export type Echantillon = {
  id: string
  image: string
  eleve: string
  classe: string
  devoir: string
  titre: string
  resume: string
  note: string
  typesAttendus: string[]
  /** Responses recorded for THIS photo: absent = online analysis. */
  enregistrement: Enregistrement | null
}

/**
 * `eager` + `import: 'default'`: without the `import` option, Vite returns the
 * MODULE (object) rather than the value — in dev, `fetch(module)` throws
 * "Cannot convert object to primitive value". Bug paid for on 12/11.
 */
const REPONSES = import.meta.glob<Enregistrement>('../../corpus/reponses/*.json', {
  eager: true,
  import: 'default',
})
const IMAGES = import.meta.glob<string>('../../corpus/demo/*.{png,jpg}', { eager: true, import: 'default' })

/** Readable title: the dominant type, and the error count when known. */
function titreCopie(id: string, enregistrement: Enregistrement): string {
  const libelle = libelleDe(enregistrement.dominant as CodeErreur)
  const fautes = enregistrement.nbFautes
  if (enregistrement.dominant === 'propre') return `${id} — no errors detected`
  return fautes === undefined ? `${id} — ${libelle}` : `${libelle} — ${fautes} mistake(s)`
}

/**
 * The samples: every paper described in `corpus/copies-demo.json` for which a
 * photo exists. This is the single source of truth — the same one that produced
 * the photos and the recorded responses.
 */
function construireEchantillons(): Echantillon[] {
  const echantillons: Echantillon[] = []
  for (const copie of descriptionDemo.copies) {
    const image = IMAGES[`../../corpus/demo/${copie.id}.jpg`] ?? IMAGES[`../../corpus/demo/${copie.id}.png`]
    if (!image) continue
    echantillons.push({
      id: copie.id,
      image,
      eleve: copie.eleve,
      classe: copie.classe,
      devoir: copie.devoir,
      titre: copie.titre,
      resume: copie.resume ?? '',
      note: copie.note ?? '',
      typesAttendus: copie.types_attendus ?? [],
      enregistrement: REPONSES[`../../corpus/reponses/${copie.id}.json`] ?? null,
    })
  }
  return echantillons
}

export const COPIES_ECHANTILLON: Echantillon[] = construireEchantillons()

/** A sample by its identifier. */
export function echantillonDe(id: string): Echantillon | undefined {
  return COPIES_ECHANTILLON.find((e) => e.id === id)
}

/**
 * Card title for the "Sample papers" screen: "Jordan · Test 3 — Algebra &
 * derivatives". Student first, then the test, then the test title; the date
 * stays in the manifest, it does not take up space on the card.
 */
export function titreCarte(echantillon: Echantillon): string {
  const eleve = echantillon.eleve.split(' ')[0] ?? echantillon.eleve
  const devoir = echantillon.devoir.split(' · ')[0] ?? echantillon.devoir
  return `${eleve} · ${devoir} — ${echantillon.titre}`
}

function estEnregistre(e: Echantillon): e is Echantillon & { enregistrement: Enregistrement } {
  return e.enregistrement !== null
}

/** **Replayable** offline papers: those whose responses are captured. */
export const COPIES_DEMO: CopieDemo[] = COPIES_ECHANTILLON.filter(estEnregistre).map((e) => ({
  id: e.id,
  titre: titreCopie(e.id, e.enregistrement),
  image: e.image,
  enregistrement: e.enregistrement,
}))

export const ID_COPIES_DEMO = COPIES_DEMO.map((copie) => copie.id)

/**
 * The guided tour on the home screen: Jordan's trajectory (recurring E01
 * mistake on three papers, then a clean paper). It is the same story shown on
 * the "Sample papers" screen — the judge sees both.
 * If a recording is missing, the paper is simply skipped.
 */
export const TOUR_DEMO = ['v2-copie-1', 'v2-copie-2', 'v2-copie-3', 'v2-copie-4'].filter((id) =>
  ID_COPIES_DEMO.includes(id),
)

export function copieDemo(id?: string): CopieDemo | undefined {
  if (!id) return COPIES_DEMO[0]
  return COPIES_DEMO.find((copie) => copie.id === id)
}

/** Which step does the current prompt correspond to? (title markers) */
export function etapeDe(requete: RequeteLLM): EtapeDemo {
  const system = requete.system
  if (system.includes('Relevance guardrail')) return 'verdict'
  if (system.includes('Generating a targeted exercise')) return 'exercice'
  if (system.includes('Second pass')) return 'revue'
  return 'analyse'
}

/** Short pause: the demo replays the recording's real pace. */
function attendre(ms: number): Promise<void> {
  return new Promise((resoudre) => setTimeout(resoudre, ms))
}

/**
 * Replay client for a given paper. Two paces:
 * - no `attenteMax`: we **wait the duration actually measured** during
 *   recording — otherwise the demo would be instantaneous and therefore not
 *   credible ("0.1 s" for a full analysis is a red flag for a technical judge);
 * - `attenteMax` supplied (multi-paper guided tour): the same response, the
 *   same order, but a per-step cap so four papers fit in a few tens of
 *   seconds. The UI honestly says "accelerated".
 */
export function clientDemoPour(
  id?: string,
  options: { attente?: boolean; attenteMax?: number } = {},
): ClientBrut {
  const copie = copieDemo(id)
  if (!copie) throw new Error('Demo mode: no recorded answer in corpus/reponses/.')
  const reponses = copie.enregistrement.reponses
  const durees = copie.enregistrement.durees ?? {}
  const attendu = options.attente ?? true
  const attenteMax = options.attenteMax ?? Number.POSITIVE_INFINITY
  return async (requete: RequeteLLM) => {
    const etape = etapeDe(requete)
    const texte = reponses[etape]
    if (!texte) {
      throw new Error(
        `Demo mode: no recorded answer for step "${etape}" — recapture the corpus.`,
      )
    }
    // Durations are recorded per pipeline STEP (extrait, classifie, genere),
    // while the call is identified by its prompt. Mapping:
    const etapePipeline = {
      analyse: 'extrait',
      revue: 'classifie',
      exercice: 'genere',
      verdict: 'genere',
    }[etape]
    const duree = durees[etapePipeline]
    if (attendu && typeof duree === 'number' && duree > 0 && duree < 60_000) {
      await attendre(Math.min(duree, attenteMax))
    }
    return texte
  }
}

export function clientDemo(): ClientBrut {
  return clientDemoPour()
}

/** Recording metadata, displayed in the UI. */
export function origineDemo(id?: string) {
  const copie = copieDemo(id)
  if (!copie) return null
  return {
    titre: copie.titre,
    modele: copie.enregistrement.modele,
    enregistreLe: copie.enregistrement.enregistreLe,
    dominant: copie.enregistrement.dominant,
    nbFautes: copie.enregistrement.nbFautes ?? null,
    revues: copie.enregistrement.revues ?? 0,
  }
}

/** A demo paper, as a `File`: the pipeline runs exactly as it does for real. */
export async function fichierDemoPour(id?: string): Promise<File> {
  const copie = copieDemo(id)
  if (!copie) throw new Error('Demo mode: no recorded paper available.')
  const reponse = await fetch(copie.image)
  const blob = await reponse.blob()
  return new File([blob], `${copie.id}.png`, { type: blob.type || 'image/png' })
}

/**
 * A sample, as a `File` — recorded or not. The user thus tries a real photo:
 * the pipeline treats it exactly like a photo taken with a phone.
 */
export async function fichierEchantillon(id: string): Promise<File> {
  const echantillon = echantillonDe(id)
  if (!echantillon) throw new Error(`Sample paper not found: ${id}`)
  const reponse = await fetch(echantillon.image)
  const blob = await reponse.blob()
  return new File([blob], `${echantillon.id}.jpg`, { type: blob.type || 'image/jpeg' })
}

export async function fichierDemo(): Promise<File> {
  return fichierDemoPour()
}
