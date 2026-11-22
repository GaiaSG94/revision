/**
 * Step 6 — Targeted exercise + relevance safeguard (§18.3).
 *
 * The generator proposes, a second pass judges. If the judge refuses, we
 * regenerate — two attempts maximum — then say so honestly. We NEVER serve an
 * off-topic exercise: it is better to say "unavailable".
 */
import generationMd from '../../prompts/generation.md?raw'
import gardeFouMd from '../../prompts/garde-fou.md?raw'
import { MAX_TENTATIVES_EXERCICE } from '../domain/config'
import { exercicePour, exerciceVerifie } from '../domain/banque'
import { libelleDe, signatureDe } from '../domain/taxonomy'
import type { CodeErreur } from '../domain/taxonomy'
import type { Exercice, ExerciceVerifie, VerdictGardeFou } from '../domain/types'
import { clientParDefaut } from './client'
import type { ClientBrut } from './client'
import type { Transport } from './llm'
import { parserExercice, parserVerdict } from './schemas'

export const PROMPT_GENERATION = generationMd
export const PROMPT_GARDE_FOU = gardeFouMd

export type ArgsExercice = {
  typeDominant: CodeErreur
  extraitCopie: string
  niveau?: string
  transport: Transport
  client?: ClientBrut
  /**
   * false (default): exercise drawn from the **local bank** — no network call,
   * so step 6 is instant (idea 1). true: fresh exercise, generated and verified
   * by the model (2 calls, 30 to 110 s on the upstream).
   */
  inedit?: boolean
  /** Identifiers of exercises already offered, to serve another one. */
  dejaVus?: string[]
  /** Draw seed: the bank remains deterministic for equal options. */
  graine?: number
}

export function messageGeneration(typeDominant: CodeErreur, extraitCopie: string, niveau: string): string {
  return [
    `Error type to work on: ${typeDominant} — ${libelleDe(typeDominant)}.`,
    `Signature to look for: ${signatureDe(typeDominant)}.`,
    `Level: ${niveau}.`,
    '',
    "Excerpt of the analysed paper (do not copy it, only use its level):",
    extraitCopie.slice(0, 600),
  ].join('\n')
}

export function messageGardeFou(
  exercice: { enonce: string; indices: string[]; solution: string },
  typeDominant: CodeErreur,
  extraitCopie: string,
): string {
  return [
    `Targeted type: ${typeDominant} — ${libelleDe(typeDominant)} (${signatureDe(typeDominant)}).`,
    '',
    'Original exercise (do not copy):',
    extraitCopie.slice(0, 400),
    '',
    'Proposed exercise:',
    `Prompt: ${exercice.enonce}`,
    `Hints: ${exercice.indices.join(' | ') || 'none'}`,
    `Solution: ${exercice.solution}`,
  ].join('\n')
}

export function verdictAccepte(verdict: VerdictGardeFou): boolean {
  return verdict.travailleLeBonType && verdict.neDonneLaSolutionOrigine && verdict.memeNiveau
}

async function proposer(args: ArgsExercice, client: ClientBrut, tentative: number): Promise<Exercice> {
  const niveau = args.niveau ?? 'high school'
  const texte = await client({
    system: PROMPT_GENERATION,
    user: messageGeneration(args.typeDominant, args.extraitCopie, niveau),
    json: true,
    temperevision: 0.5,
    maxTokens: 800,
  })
  const brut = parserExercice(texte)
  return {
    enonce: brut.enonce,
    indices: brut.indices,
    solution: brut.solution,
    typeTravaille: args.typeDominant,
    niveau: brut.niveau || niveau,
    tentative,
    id: `modele-${tentative}`,
    source: 'modele',
  }
}

async function juger(
  exercice: Exercice,
  args: ArgsExercice,
  client: ClientBrut,
): Promise<VerdictGardeFou> {
  const texte = await client({
    system: PROMPT_GARDE_FOU,
    user: messageGardeFou(exercice, args.typeDominant, args.extraitCopie),
    json: true,
    temperevision: 0,
    maxTokens: 400,
  })
  return parserVerdict(texte)
}

/**
 * Entry point for step 6: local bank by default, model only for an explicitly
 * requested "fresh exercise".
 */
export async function obtenirExercice(
  args: ArgsExercice,
): Promise<{ exercice: ExerciceVerifie | null; message?: string }> {
  if (!args.inedit) {
    const tirage = exercicePour(args.typeDominant, {
      ...(args.dejaVus ? { exclure: args.dejaVus } : {}),
      ...(args.graine !== undefined ? { graine: args.graine } : {}),
    })
    if (!tirage) {
      return {
        exercice: null,
        message: `No exercise in the bank for this type (${libelleDe(args.typeDominant)}).`,
      }
    }
    return { exercice: exerciceVerifie(tirage) }
  }
  return genererExerciceVerifie(args)
}

export async function genererExerciceVerifie(
  args: ArgsExercice,
): Promise<{ exercice: ExerciceVerifie | null; message?: string }> {
  const client = args.client ?? clientParDefaut(args.transport)
  for (let tentative = 1; tentative <= MAX_TENTATIVES_EXERCICE; tentative += 1) {
    const exercice = await proposer(args, client, tentative)
    const verdict = await juger(exercice, args, client)
    if (verdictAccepte(verdict)) return { exercice: { exercice, verdict } }
  }
  return {
    exercice: null,
    message: `Exercise unavailable for this type (${libelleDe(args.typeDominant)}): better nothing than an off-topic exercise.`,
  }
}
