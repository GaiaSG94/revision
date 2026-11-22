import { Section } from './Section'
import { SECTIONS } from './catalogue'
import { LigneLien } from './LigneLien'
import type { Lien } from './LigneLien'
import { DEMO, DEPOT, docDuDepot } from './lienDepot'

/** Two groups: see the product, then read what documents it. */
const GROUPES: { titre: string; liens: Lien[] }[] = [
  {
    titre: 'See the product',
    liens: [
      {
        etiquette: 'Online demo',
        href: DEMO,
        detail:
          'The deployed webapp, usable without installation. A demo mode takes over if the upstream is saturated.',
      },
      {
        etiquette: 'GitHub repository',
        href: DEPOT,
        detail: 'Code, tests, corpus, prompts and CI: everything is public, under the MIT licence.',
      },
    ],
  },
  {
    titre: 'Repository documents',
    liens: [
      {
        etiquette: 'README',
        href: docDuDepot('README.md'),
        detail: 'The product in one page: pipeline, taxonomy, profile rules, how to run it.',
      },
      {
        etiquette: 'Write-up',
        href: docDuDepot('docs/WRITEUP.md'),
        detail: 'The design story: the problem, the choices, the accepted dead ends.',
      },
      {
        etiquette: 'Video script',
        href: docDuDepot('docs/SCRIPT-VIDEO.md'),
        detail: 'The second-by-second breakdown of the demo video (3 minutes).',
      },
      {
        etiquette: 'Product checklist',
        href: docDuDepot('docs/CHECKLIST-SOUMISSION.md'),
        detail: 'The contest acceptance criteria, one by one, and where each is met.',
      },
      {
        etiquette: 'Architecture',
        href: docDuDepot('docs/ARCHITECTURE.md'),
        detail: 'The four defining choices, the pipeline and the RNF-P1 to P5 rules.',
      },
      {
        etiquette: 'Model validation',
        href: docDuDepot('docs/VALIDATION-MODELE.md'),
        detail: 'The live bench, the corpus, each paper and its latency: the source of the figures.',
      },
    ],
  },
]

/** Section 7: leaving the screen — demo, repository, documents. */
export function SectionLiens() {
  return (
    <Section {...SECTIONS.liens}>
      <p className="text-sm text-muet">
        Judges browse the site: here are the three places where the project can really be verified.
      </p>
      {GROUPES.map((groupe) => (
        <div key={groupe.titre} className="space-y-2">
          <h3 className="text-lg font-semibold text-texte">{groupe.titre}</h3>
          <ul className="space-y-2">
            {groupe.liens.map((lien) => (
              <LigneLien key={lien.href} lien={lien} />
            ))}
          </ul>
        </div>
      ))}
    </Section>
  )
}
