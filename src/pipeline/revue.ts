/**
 * Step 4b — second pass on uncertain errors (batch 3).
 *
 * The risk the spec calls fatal is the false positive: a Revision that invents
 * errors destroys trust. The 0.6 threshold rules out plainly doubtful answers,
 * but lets through an error typed at 0.7 on an ambiguous annotation. Hence this
 * re-read: a second call, **text only** (so fast and cheap), which confirms,
 * reclassifies or downgrades to E99 — never adding an error.
 */
import promptMd from '../../prompts/revue.md?raw'
import { MAX_FAUTES_A_REVOIR, SEUIL_REVUE } from '../domain/config'
import { normaliserErreur } from '../domain/diagnostic'
import { libelleDe } from '../domain/taxonomy'
import type { Erreur } from '../domain/types'
import { clientParDefaut } from './client'
import type { ClientBrut } from './client'
import { blocTaxonomie } from './classify'
import type { Transport } from './llm'
import { parserRevue } from './schemas'

export const PROMPT_REVUE = promptMd.replace('{{TAXONOMIE}}', blocTaxonomie())

export type ResultatRevue = { erreurs: Erreur[]; revues: number; modifiees: number }

/** An error needs review if it is typed but below the review threshold. */
export function aRevoir(erreur: Erreur): boolean {
  return erreur.code !== 'E99' && erreur.confiance > 0 && erreur.confiance < SEUIL_REVUE
}

/** Indices to review, least certain first, capped to keep latency bounded. */
export function indicesASurveiller(erreurs: Erreur[]): number[] {
  return erreurs
    .map((erreur, index) => ({ index, erreur }))
    .filter(({ erreur }) => aRevoir(erreur))
    .sort((a, b) => a.erreur.confiance - b.erreur.confiance)
    .slice(0, MAX_FAUTES_A_REVOIR)
    .map(({ index }) => index)
}

export function messageRevue(erreurs: Erreur[], indices: number[]): string {
  const lignes = indices.map((index, position) => {
    const erreur = erreurs[index]!
    return [
      `${position}. line: ${erreur.ligne}`,
      `   proposed code: ${erreur.code} (${libelleDe(erreur.code)}), confidence ${erreur.confiance.toFixed(2)}`,
      `   proposed explanation: ${erreur.explication}`,
    ].join('\n')
  })
  return ['Errors to re-check, in this order:', '', lignes.join('\n')].join('\n')
}

/** Applies the verdicts: only the requested indices may change. */
export function appliquerRevue(
  erreurs: Erreur[],
  indices: number[],
  verdicts: ReturnType<typeof parserRevue>,
): { erreurs: Erreur[]; modifiees: number } {
  const parPosition = new Map(verdicts.map((v) => [v.index, v]))
  let modifiees = 0
  const resultat = erreurs.map((erreur, index) => {
    const position = indices.indexOf(index)
    const verdict = position >= 0 ? parPosition.get(position) : undefined
    if (!verdict) return erreur
    const revue = normaliserErreur({
      code: verdict.code,
      ligne: erreur.ligne,
      explication: verdict.explication || erreur.explication,
      confiance: verdict.confiance,
      ...(erreur.zone ? { zone: erreur.zone } : {}),
    })
    if (revue.code !== erreur.code || revue.confiance !== erreur.confiance) modifiees += 1
    return revue
  })
  return { erreurs: resultat, modifiees }
}

export async function revoirFautesPeuSures(
  erreurs: Erreur[],
  transport: Transport,
  client: ClientBrut = clientParDefaut(transport),
): Promise<ResultatRevue> {
  const indices = indicesASurveiller(erreurs)
  if (indices.length === 0) return { erreurs, revues: 0, modifiees: 0 }

  const texte = await client({
    system: PROMPT_REVUE,
    user: messageRevue(erreurs, indices),
    json: true,
    temperevision: 0,
    maxTokens: 600,
  })
  const { erreurs: revues, modifiees } = appliquerRevue(erreurs, indices, parserRevue(texte))
  return { erreurs: revues, revues: indices.length, modifiees }
}
