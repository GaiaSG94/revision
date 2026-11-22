import { glossaire } from '../../../domain/pedagogie'
import { SEUIL_CONFIANCE } from '../../../domain/config'
import { Section } from './Section'
import { SECTIONS } from './catalogue'
import { TypeReplie } from './TypeReplie'

/** The three locks that hold the diagnosis — the threshold comes from config. */
function verrous(seuil: string): { regle: string; effet: string }[] {
  return [
    {
      regle: 'One error = one single type',
      effet:
        'even when two causes overlap, we arbitrate. This is what makes the profile countable and accuracy measurable.',
    },
    {
      regle: `Confidence < ${seuil} → E99 "untyped"`,
      effet:
        'the error is displayed, but excluded from the profile: we build no work plan on a doubt.',
    },
    {
      regle: 'E11 "copying mistake" weighted at 0',
      effet:
        'it is reported to the student, but does not weigh on their weaknesses: carelessness is not a gap.',
    },
  ]
}

/** Section 2: the closed taxonomy, collapsed by default, and its three locks. */
export function SectionTaxonomie() {
  const types = glossaire()
  const seuil = SEUIL_CONFIANCE.toString().replace('.', ',')
  return (
    <Section {...SECTIONS.taxonomie}>
      <p className="text-sm text-muet">
        The model never invents a category: it chooses from these {types.length} closed codes,
        or answers <span className="font-mono text-texte">E99</span>. This lock is what makes the
        diagnosis measurable — and prevents a vague answer from passing as an analysis.
      </p>
      <div className="space-y-2">
        {types.map((explication) => (
          <TypeReplie key={explication.code} explication={explication} />
        ))}
      </div>
      <p className="text-xs text-muet">
        Expand a type: why this error happens, the concrete move that avoids it, a wrong example
        and its correct version, and the neighbouring trap it resembles.
      </p>
      <h3 className="pt-1 text-lg font-semibold text-texte">The three locks</h3>
      <ul className="space-y-2">
        {verrous(seuil).map((verrou) => (
          <li
            key={verrou.regle}
            className="rounded-lg border border-jaune/40 bg-surface-2 p-3 text-sm"
          >
            <span className="font-medium text-jaune">{verrou.regle}</span>
            <span className="text-muet"> — {verrou.effet}</span>
          </li>
        ))}
      </ul>
    </Section>
  )
}
