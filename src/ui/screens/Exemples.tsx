import { COPIES_ECHANTILLON, echantillonDe, titreCarte } from '../../pipeline/demo'
import { useRature } from '../../etat/useRevision'

/** Displayed cards, in order: Jordan's trajectory, then live papers. */
const ORDRE = [
  'v2-copie-1',
  'v2-copie-2',
  'v2-copie-3',
  'v2-copie-4',
  'copie-demo-5',
  'copie-demo-6',
]

/** English labels for the two "live" samples (French papers). */
const HABILLAGE_LIVE: Record<string, { titre: string; resume: string }> = {
  'copie-demo-5': {
    titre: 'Noé · Test 3',
    resume: 'Special products and fractions. Sent to the live model through the edge proxy.',
  },
  'copie-demo-6': {
    titre: 'Inès · Test 2',
    resume: 'Rounding, units, distributing. Sent to the live model through the edge proxy.',
  },
}

function etiquette(echantillon: (typeof COPIES_ECHANTILLON)[number]): string {
  if (!echantillon.enregistrement) return 'Live model'
  if (echantillon.enregistrement.dominant === 'propre') return 'Clean paper'
  const types = echantillon.typesAttendus.filter((code) => code !== 'E11')
  if (types.length === 0) return 'Typed mistakes'
  // Several targeted types: name them all ("E01 · E03", v9 mockup).
  // A single one: it is the recurring mistake, say so.
  if (types.length > 1) return types.join(' · ')
  const type = types[0]!
  return echantillon.enregistrement.dominant === type ? `${type} again` : type
}

function classeEtiquette(echantillon: (typeof COPIES_ECHANTILLON)[number]): string {
  if (!echantillon.enregistrement) return 'sticker sticker-blanc'
  if (echantillon.enregistrement.dominant === 'propre') return 'sticker sticker-menthe'
  return 'sticker sticker-ambre'
}

/**
 * "Sample papers" screen (V9 mockup, section B): the gallery leaves the home
 * screen and gets its own screen. Everything is in English, no note on the card
 * — only what the paper contains. The honest "written for this demo" mention
 * stays visible to the user.
 */
export function Exemples() {
  const { analyserEchantillon, occupe, aller } = useRature()
  const cartes = ORDRE.map((id) => echantillonDe(id)).filter(
    (echantillon): echantillon is NonNullable<typeof echantillon> => echantillon !== undefined,
  )

  return (
    <div className="space-y-4">
      <button type="button" className="revision-retour" onClick={() => aller('accueil')}>
        ← Back
      </button>
      <h1 className="text-4xl">Try a sample paper</h1>
      <p className="max-w-[70ch] text-sm text-muet">
        Pick one. The app analyses it exactly like a photo you took. Three papers from the same
        student show how a mistake keeps coming back — and the fourth shows it fixed.
      </p>
      <span className="sticker sticker-blanc inline-block">Sample papers written for this demo</span>

      <div className="revision-exemples-grille">
        {cartes.map((echantillon) => {
          const live = HABILLAGE_LIVE[echantillon.id]
          // No recording = online analysis (edge proxy): we say so.
          const estLive = Boolean(live) || !echantillon.enregistrement
          // "Jordan · Test 3 — Algebra & derivatives" (see titreCarte).
          const titre = live?.titre ?? titreCarte(echantillon)
          const resume = live?.resume ?? echantillon.resume
          return (
            <button
              key={echantillon.id}
              type="button"
              className="revision-exemple"
              onClick={() => void analyserEchantillon(echantillon.id)}
              disabled={occupe}
            >
              <figure>
                <img src={echantillon.image} alt={`${titre} — sample corrected paper`} loading="lazy" />
                <span className={classeEtiquette(echantillon)}>{etiquette(echantillon)}</span>
              </figure>
              <div className="corps">
                <b>{titre}</b>
                <span>{resume}</span>
                <span className={estLive ? 'revision-exemple-action revision-exemple-action-blanc' : 'revision-exemple-action revision-exemple-action-menthe'}>
                  {estLive ? 'Analyse live' : 'Analyse this paper'}
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
