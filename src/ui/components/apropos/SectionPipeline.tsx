import { ETAPES } from '../../../domain/etapes'
import { BUDGET_PIPELINE_MS, MAX_FAUTES_A_REVOIR, SEUIL_REVUE } from '../../../domain/config'
import type { EtapeId } from '../../../domain/types'
import { Section } from './Section'
import { SECTIONS } from './catalogue'
import { LignePipeline } from './LignePipeline'
import type { FicheEtape } from './LignePipeline'

/**
 * Contract and latency of each step. Labels are NOT copied: they come from
 * `ETAPES`. Latencies are those measured on the corpus and the public demo
 * (docs/VALIDATION-MODELE.md), not targets.
 */
const FICHES: Record<EtapeId, FicheEtape> = {
  ingest: {
    entree: 'your photo (file up to 10 MB)',
    sortie: 'a 1600 px data URL, contrast stretched',
    latence: '< 300 ms',
    note: 'Locally, on your device: nothing goes over the network at this stage.',
  },
  anonymise: {
    entree: 'the step 1 data URL',
    sortie: 'the same data URL, name banner pixelated',
    latence: '< 500 ms',
    note: 'The name is masked before anything is displayed or sent (RNF-P2).',
  },
  extrait: {
    entree: 'the anonymized data URL + the analysis prompt',
    sortie: 'the teacher\u2019s annotations, line by line',
    latence: '16 to 50 s',
    note: 'A single vision call for steps 3 and 4. Measured on the corpus: 22 s on average, 6.7 s on a clean paper. The range comes from the upstream (marketplace), not from the code.',
  },
  classifie: {
    entree: 'the annotations read at step 3',
    sortie: 'each error typed into the 12 codes, with a confidence score',
    latence: '0 s extra',
    note: 'Same response as step 3: no additional call. Thresholds are applied client-side, never by the model.',
  },
  agrege: {
    entree: 'the typed errors + the local history',
    sortie: 'your error profile: recurrence, evolution, dominant type',
    latence: '< 50 ms',
    note: 'Locally, in IndexedDB. No data leaves the device here.',
  },
  genere: {
    entree: 'the dominant type of your profile + the paper excerpt',
    sortie: 'an exercise verified by the guardrail, or an explicit refusal',
    latence: '< 6 s',
    note: 'Two separate calls: generation, then judging. The diagnosis is already displayed during this time.',
  },
}

/** Section 1: the pipeline made visible, with its real latency figures. */
export function SectionPipeline() {
  const seuilRevue = SEUIL_REVUE.toString().replace('.', ',')
  return (
    <Section {...SECTIONS.pipeline}>
      <p className="text-sm text-muet">
        From the photo to the targeted exercise: six steps, with a target budget of{' '}
        <span className="font-mono text-texte">{BUDGET_PIPELINE_MS / 1000} s</span> to go from
        photo to diagnosis. The latencies below are measured, not claimed.
      </p>
      <ol className="space-y-2">
        {ETAPES.map(({ id, libelle }, index) => (
          <LignePipeline key={id} ordre={index + 1} libelle={libelle} fiche={FICHES[id]} />
        ))}
      </ol>
      <p className="rounded-xl border border-jaune/50 bg-jaune/10 p-3 text-sm text-texte">
        <span className="font-semibold text-jaune">
          Why steps 3 and 4 make only one call.{' '}
        </span>
        Each round trip with the upstream costs 16 to 50 s depending on model availability: two
        sequential calls dropped the "photo → diagnosis" budget to 40-90 s, merging brings it back
        to 22 s on average without losing accuracy (4 papers out of 5 correctly typed).
      </p>
      <p className="text-xs text-muet">
        Step 4b, outside the six labels: errors whose confidence is below{' '}
        <span className="font-mono">{seuilRevue}</span> are re-checked by a text-only call, capped at{' '}
        {MAX_FAUTES_A_REVOIR} errors — it confirms, reclassifies or downgrades to E99, without ever
        adding an error.
      </p>
    </Section>
  )
}
