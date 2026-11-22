import { MAX_TENTATIVES_EXERCICE } from '../../../domain/config'
import { Section } from './Section'
import { SECTIONS } from './catalogue'

/** The three booleans returned by `prompts/garde-fou.md` — judged after generation. */
const CRITERES: { cle: string; question: string; exemple: string }[] = [
  {
    cle: 'travailleLeBonType',
    question: 'Does the exercise really make you perform the move of the targeted type?',
    exemple: 'For E01 "lost sign", it must be an expansion with signs to handle.',
  },
  {
    cle: 'neDonneLaSolutionOrigine',
    question: 'Does it avoid copying the original exercise and its solution?',
    exemple: 'Same numbers, same prompt = refusal: we practise, we do not replay the paper.',
  },
  {
    cle: 'memeNiveau',
    question: 'Is the level consistent with the analysed paper?',
    exemple: 'Neither too easy (no progress) nor out of reach (no success possible).',
  },
]

/** Message really returned by `src/pipeline/exercise.ts` when everything fails. */
const REFUS =
  'Exercise unavailable for this type (Mishandled power): better nothing than an off-topic exercise.'

/** Section 3: the exercise is generated, then judged — and refusal is accepted. */
export function SectionGardeFou() {
  return (
    <Section {...SECTIONS.gardeFou}>
      <p className="text-sm text-muet">
        An off-topic exercise is worse than no exercise: the student works beside their weakness and
        the app lies. Generation and judging are therefore{' '}
        <span className="text-texte">two separate calls, never a single one</span> — the model that
        writes the exercise is not the one that validates it.
      </p>
      <h3 className="text-lg font-semibold text-texte">The three checks</h3>
      <ul className="space-y-2">
        {CRITERES.map((critere, index) => (
          <li key={critere.cle} className="rounded-lg border border-bord bg-surface-2 p-3">
            <p className="text-sm font-medium text-texte">
              <span className="mr-2 font-mono text-vert" aria-hidden="true">
                {index + 1}
              </span>
              {critere.question}
            </p>
            <p className="mt-1 text-xs text-muet">{critere.exemple}</p>
          </li>
        ))}
      </ul>
      <div className="space-y-2 rounded-xl border border-jaune/50 bg-jaune/10 p-3 text-sm">
        <p className="text-texte">
          <span className="font-semibold text-jaune">
            {MAX_TENTATIVES_EXERCICE} attempts maximum.
          </span>{' '}
          A single failed check triggers regeneration, with the reasons for refusal. Beyond that, the
          pipeline returns <span className="font-mono">exercice: null</span> and an explicit message:
          never a doubtful exercise just to fill the screen.
        </p>
        <p className="rounded bg-surface px-2 py-1 font-mono text-xs text-jaune">"{REFUS}"</p>
      </div>
    </Section>
  )
}
