/**
 * Step 4 — Classification: each annotation receives a code from the closed
 * taxonomy, with a confidence. The threshold (0.6) and weighting (E11 = 0) are
 * applied by `normaliserErreur`, not by the model: we hold the rule, never the
 * model.
 */
import promptMd from '../../prompts/classification.md?raw'
import { TAXONOMIE } from '../domain/taxonomy'
import { normaliserErreur } from '../domain/diagnostic'
import type { Erreur, Extraction } from '../domain/types'
import { clientParDefaut } from './client'
import type { ClientBrut } from './client'
import type { Transport } from './llm'
import { parserClassification } from './schemas'

/** Taxonomy rendered as text: a single source of truth, the code. */
export function blocTaxonomie(): string {
  return TAXONOMIE.map((t) => `- \`${t.code}\` — **${t.libelle}** : ${t.signature}`).join('\n')
}

export const PROMPT_CLASSIFICATION = promptMd.replace('{{TAXONOMIE}}', blocTaxonomie())

/** Annotations are numbered: the model answers in the same order. */
export function messageAnnotations(extraction: Extraction): string {
  const lignes = extraction.annotations.map((annotation, index) => {
    const morceaux = [`${index + 1}. line: ${annotation.ligne}`, `   annotation: ${annotation.annotation}`]
    if (annotation.eleve) morceaux.push(`   written by the student: ${annotation.eleve}`)
    if (annotation.attendu) morceaux.push(`   expected (per the teacher): ${annotation.attendu}`)
    return morceaux.join('\n')
  })
  return [
    "From the paper: one annotation = one error. File each one.",
    '',
    lignes.join('\n'),
  ].join('\n')
}

export async function classerAnnotations(
  extraction: Extraction,
  transport: Transport,
  client: ClientBrut = clientParDefaut(transport),
): Promise<Erreur[]> {
  // Clean paper: classify nothing. Zero calls, zero invented errors (RNF-04).
  if (extraction.copiePropre || extraction.annotations.length === 0) return []

  const texte = await client({
    system: PROMPT_CLASSIFICATION,
    user: messageAnnotations(extraction),
    json: true,
    temperevision: 0.1,
    maxTokens: 2000,
  })
  return parserClassification(texte).map(normaliserErreur)
}
