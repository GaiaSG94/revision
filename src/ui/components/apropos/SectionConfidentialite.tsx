import { Section } from './Section'
import { SECTIONS } from './catalogue'

/** RNF-P1 to P5 (docs/ARCHITECTURE.md), translated into plain language. */
const REGLES: { ref: string; titre: string; texte: string }[] = [
  {
    ref: 'RNF-P1',
    titre: 'Your paper is never saved',
    texte:
      'the image lives in memory during the analysis, then disappears. It is written neither in your browser nor on a server.',
  },
  {
    ref: 'RNF-P2',
    titre: 'Your name is masked before anything else',
    texte:
      'from step 2, the header banner is pixelated: neither the screen, nor the model, nor the proxy can see the student\u2019s identity.',
  },
  {
    ref: 'RNF-P3',
    titre: 'The proxy does not read your paper',
    texte:
      'it keeps the API key server-side and logs only the timestamp, the HTTP status code and the latency — no content.',
  },
  {
    ref: 'RNF-P4',
    titre: 'Your history belongs to you',
    texte:
      'it stays local (IndexedDB) on this device, with no account or database; you can export it and delete everything from the Settings screen.',
  },
  {
    ref: 'RNF-P5',
    titre: 'We write it, we do not assume it',
    texte:
      'the mention "no paper is ever stored" is displayed in the interface: home, framing, settings and footer.',
  },
]

/** Section 4: the five privacy rules, enforced in the code. */
export function SectionConfidentialite() {
  return (
    <Section {...SECTIONS.confidentialite}>
      <p className="text-sm text-muet">
        No data backend: no database, no authentication, no server-side analysis.
        Here are the five requirements from the spec and what they mean for you.
      </p>
      <ul className="space-y-2">
        {REGLES.map((regle) => (
          <li key={regle.ref} className="rounded-lg border border-bord bg-surface-2 p-3">
            <p className="text-sm">
              <span className="mr-2 rounded-full border border-vert/50 px-2 py-0.5 font-mono text-xs text-vert">
                {regle.ref}
              </span>
              <span className="font-medium text-texte">{regle.titre}</span>
              <span className="text-muet"> — {regle.texte}</span>
            </p>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muet">
        And what the product does not do either: it does not grade your paper, never gives the answer
        to the original exercise, and trains no model.
      </p>
    </Section>
  )
}
