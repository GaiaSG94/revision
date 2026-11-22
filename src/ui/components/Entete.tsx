import { useRature } from '../../etat/useRevision'
import type { Ecran } from '../../etat/useRevision'

const LIENS: { ecran: Ecran; libelle: string }[] = [
  { ecran: 'accueil', libelle: 'Paper' },
  // V9: navigation reduced to 4 entries. "Diagnosis" is not a tab: you get
  // there after an analysis, and the header's "Diagnosis ready" badge leads
  // there. Settings remains accessible via the ⚙ icon.
  { ecran: 'profil', libelle: 'Profile' },
  { ecran: 'prof', libelle: 'Teacher' },
  { ecran: 'apropos', libelle: 'How it works' },
]

/** Subtle badge: the analysis continues while the user navigates. */
function BadgeAnalyse() {
  const { occupe, diagnosticPret, aller, ecran } = useRature()
  if (ecran === 'analyse') return null
  if (occupe) {
    return (
      <button
        type="button"
        onClick={() => aller('analyse')}
        className="etape-en-cours sticker sticker-ambre text-xs"
      >
        Analysing…
      </button>
    )
  }
  if (diagnosticPret) {
    return (
      <button
        type="button"
        onClick={() => aller('diagnostic')}
        className="sticker sticker-menthe text-xs"
      >
        Diagnosis ready
      </button>
    )
  }
  return null
}

export function Entete() {
  const { ecran, aller } = useRature()
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <button
        type="button"
        onClick={() => aller('accueil')}
        className="font-[family-name:var(--font-etroite)] text-2xl font-bold italic tracking-tight text-white"
      >
        revision!
      </button>
      <BadgeAnalyse />
      <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-1">
        {LIENS.map((lien) => (
          <button
            key={lien.ecran}
            type="button"
            onClick={() => aller(lien.ecran)}
            aria-current={ecran === lien.ecran ? 'page' : undefined}
            className={[
              'rounded-full px-3 py-1.5 text-sm font-medium transition',
              ecran === lien.ecran ? 'bg-texte text-fond' : 'text-white/80 hover:text-white',
            ].join(' ')}
          >
            {lien.libelle}
          </button>
        ))}
        <button
          type="button"
          onClick={() => aller('reglages')}
          aria-label="Settings"
          title="Settings"
          aria-current={ecran === 'reglages' ? 'page' : undefined}
          className={[
            'rounded-full px-2.5 py-1.5 text-sm transition',
            ecran === 'reglages' ? 'bg-texte text-fond' : 'text-white/80 hover:text-white',
          ].join(' ')}
        >
          ⚙
        </button>
      </nav>
    </header>
  )
}
