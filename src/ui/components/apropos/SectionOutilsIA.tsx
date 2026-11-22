import { AMONT_PAR_DEFAUT, CHAINE_MODELES, MODELE_PAR_DEFAUT } from '../../../domain/config'
import { Section } from './Section'
import { SECTIONS } from './catalogue'
import { BlocListe } from './BlocListe'
import { LienExterne } from './LienExterne'
import { docDuDepot } from './lienDepot'

/** What the product calls during an analysis — and nothing else. */
const PRODUIT = [
  `An [OI]-compatible multimodal API served by InferHub (${AMONT_PAR_DEFAUT}), behind an edge proxy that keeps the key server-side. As a fallback, you can paste your own key (BYOK): it stays on your device.`,
  `Default model ${MODELE_PAR_DEFAUT}, with a fallback chain over ${CHAINE_MODELES.length} models in the ag/ family: a 402 or a 5xx moves to the next one, and the analysis still succeeds.`,
  'Three uses, no more: read and type the teacher\u2019s annotations (vision), generate the targeted exercise, then judge that exercise (guardrail). No classic OCR.',
  'Prompts are versioned in prompts/ (analysis, extraction, classification, review, generation, guardrail): they are part of the product just like the code.',
]

/** What was assisted, declared without any grey area. */
const DEVELOPPEMENT = [
  'ZeroClaw coding agents and their sub-agents: writing the TypeScript/React code, the tests, the CI configuration and the documentation.',
  'Models via InferHub: automatic resolution of rebase conflicts in the merge queue.',
  'CI scope agent: drafting the "Scope" block of pull requests from the diff.',
  'Honest estimate: most of the code volume is assisted, all design decisions and business rules are human.',
]

/** What is not generated — the decisions that make the product. */
const DECISIONS = [
  'The taxonomy of 12 types and their signatures.',
  'The profile weighting rules: confidence threshold, E99 excluded, E11 with zero weight.',
  'The validation corpus and its associated ground truth.',
  'The colour palette, and the refusal of red in the interface: the paper is already annotated in red by the teacher.',
]

/** Section 6: the AI called by the product, and the AI that helped write it. */
export function SectionOutilsIA() {
  return (
    <Section {...SECTIONS.outilsIA}>
      <p className="text-sm text-muet">
        Two distinct uses, and they do not mix: the AI the product calls for you during an analysis,
        and the AI that helped write it.
      </p>
      <BlocListe titre="What the product calls" items={PRODUIT} />
      <BlocListe titre="What was assisted in development" items={DEVELOPPEMENT} />
      <BlocListe titre="What is not generated" items={DECISIONS} ton="vert" />
      <p className="text-sm text-muet">
        Full declaration, tool by tool:{' '}
        <LienExterne href={docDuDepot('docs/DECLARATION-IA.md')}>docs/DECLARATION-IA.md</LienExterne>.
      </p>
    </Section>
  )
}
