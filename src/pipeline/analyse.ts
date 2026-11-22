/**
 * Steps 3+4 merged — a single vision call returns the teacher's annotations
 * AND their typing.
 *
 * Why merge: measured on 11 November, each round trip with the upstream costs
 * 16 to 50 s (marketplace, models sometimes out of capacity). Two sequential
 * calls dropped the "photo → diagnosis" budget to 40-90 s. A single call brings
 * it back to the ~20 s of the spec (RNF-01).
 *
 * What does not change: the **rules** stay local. The model suggests codes and
 * confidences; the 0.6 threshold, downgrade to E99 and zero weighting of E11
 * are applied by `normaliserErreur`, never by it.
 */
import promptMd from '../../prompts/analyse.md?raw'
import { normaliserErreur } from '../domain/diagnostic'
import type { Erreur, Extraction } from '../domain/types'
import { clientParDefaut } from './client'
import type { ClientBrut } from './client'
import { blocTaxonomie } from './classify'
import type { Transport } from './llm'
import { parserAnalyse } from './schemas'

export const PROMPT_ANALYSE = promptMd.replace('{{TAXONOMIE}}', blocTaxonomie())

export type AnalyseFusionnee = { extraction: Extraction; erreurs: Erreur[] }

export function messageAnalyse(): string {
  return [
    'Here is the photo of a corrected paper.',
    "List the teacher's annotations and type each one in the taxonomy, then return the requested JSON.",
  ].join(' ')
}

/** Converts the merged annotations into `Extraction` + normalized errors. */
export function decouperAnalyse(brut: ReturnType<typeof parserAnalyse>): AnalyseFusionnee {
  const extraction: Extraction = {
    annotations: brut.annotations.map((a) => ({
      ligne: a.ligne,
      annotation: a.annotation,
      ...(a.eleve ? { eleve: a.eleve } : {}),
      ...(a.attendu ? { attendu: a.attendu } : {}),
      ...(a.zone ? { zone: a.zone } : {}),
    })),
    copiePropre: brut.copiePropre,
    ...(brut.nomDetecte ? { nomDetecte: brut.nomDetecte } : {}),
  }
  // Clean paper: no error, whatever the model wrote (RNF-04).
  const erreurs = extraction.copiePropre
    ? []
    : brut.annotations.map((a) =>
        normaliserErreur({
          code: a.code,
          ligne: a.ligne,
          explication: a.explication,
          confiance: a.confiance,
          ...(a.zone ? { zone: a.zone } : {}),
        }),
      )
  return { extraction, erreurs }
}

export async function analyserImage(
  dataUrl: string,
  transport: Transport,
  client: ClientBrut = clientParDefaut(transport),
): Promise<AnalyseFusionnee> {
  const texte = await client({
    system: PROMPT_ANALYSE,
    user: messageAnalyse(),
    image: dataUrl,
    json: true,
    temperevision: 0.1,
    maxTokens: 1600,
  })
  return decouperAnalyse(parserAnalyse(texte))
}
