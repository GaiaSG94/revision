import { Section } from './Section'
import { SECTIONS } from './catalogue'
import { ChiffreCle } from './ChiffreCle'

/**
 * Figures from docs/VALIDATION-MODELE.md, the Vite build and CI.
 * No invented number, no convenient rounding: every value carries its source,
 * and what is not yet measured is stated below.
 */
const MESURES: { valeur: string; legende: string; source: string }[] = [
  {
    valeur: '86 %',
    legende: 'correct dominant type on clean papers (6 out of 7).',
    source: 'live bench tests/live/inferhub.test.ts, corpus of 11 papers, 11 Nov. 2026.',
  },
  {
    valeur: '100 %',
    legende:
      'on degraded papers (2 out of 2): 2-3° rotation, uneven light, noise, slight blur.',
    source: 'same live bench, same phone-like shooting conditions.',
  },
  {
    valeur: '0',
    legende:
      'false positive on the 2 clean papers (clean and degraded): no invented error.',
    source: 'same live bench — RNF-04 requirement, the risk qualified as fatal.',
  },
  {
    valeur: '6 / 8',
    legende:
      'proxy calls returning 503 during a real analysis, all absorbed by the fallback chain: the diagnosis still arrived.',
    source: 'end-to-end public demo, 11 Nov. 10:27 p.m., no key on the browser side.',
  },
  {
    valeur: '≈ 112 KB',
    legende: 'the compressed JavaScript bundle (gzip), React included.',
    source: 'npx vite build, bundle measured on dist/assets/ (±1 KB depending on repo state).',
  },
  {
    valeur: '170',
    legende: 'passing tests without network or quota, including 74 crash tests (hostile data, volume, failures).',
    source: 'npm test in CI: 16 files passed, 3 live benches skipped without a key. Details: docs/CRASH-TEST.md.',
  },
]

/** Section 5: the measurements, their sources, and what we do not hide. */
export function SectionMesures() {
  return (
    <Section {...SECTIONS.mesures}>
      <ul className="grid gap-2 sm:grid-cols-2">
        {MESURES.map((mesure) => (
          <ChiffreCle
            key={mesure.valeur}
            valeur={mesure.valeur}
            legende={mesure.legende}
            source={mesure.source}
          />
        ))}
      </ul>
      <div className="space-y-2 rounded-xl border border-bord bg-surface-2 p-3 text-xs text-muet">
        <p>
          <span className="font-medium text-texte">What we do not hide.</span> Paper 8 is the
          bench's only failure: <span className="font-mono">E10</span> returned where ground truth
          expects <span className="font-mono">E09</span>. The paper mixes premature rounding, a
          missing unit and a wrong conversion — it is an ambiguity in the fixture, not a model bug,
          and it argues for single-error fixtures.
        </p>
        <p>
          The corpus is synthetic (generated papers, simulated handwriting): it validates the
          prompt contract, the taxonomy and robustness to shooting conditions, not the reading of
          real handwriting — protocol written in <span className="font-mono">corpus/README.md</span>.
        </p>
      </div>
    </Section>
  )
}
