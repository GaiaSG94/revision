/**
 * Schemas and parsers for model responses.
 *
 * Two principles, from the crash test of 12/11:
 *  1. **Nothing enters without passing through here** — a model that answers
 *     off-topic must neither break the screen nor invent a category outside the
 *     taxonomy;
 *  2. **Bound and sanitize, never reject wholesale** — a malformed annotation
 *     costs that annotation, not the whole paper; texts and lists are capped so
 *     the UI cannot freeze.
 *
 * Strict typing remains guaranteed on output: `Annotation`, `ErreurBrute`,
 * `Exercice`, `VerdictGardeFou`.
 */
import { z } from 'zod'
import { MAX_ANNOTATIONS, MAX_LONGUEUR_LIGNE } from '../domain/config'
import type { Annotation, Extraction, VerdictGardeFou, Zone } from '../domain/types'
import { ErreurLLM, extraireJson } from './llm'
import {
  confianceAssainie,
  listeTolerante,
  plafonner,
  texteAssaini,
  texteOptionnelAssaini,
  zoneAssainie,
} from '../domain/tolerance'

/** Annotation + typing, as returned by the merged call. */
export type AnnotationFusionnee = Annotation & {
  code: string
  confiance: number
  explication: string
}

export type ErreurBrute = {
  code: string
  ligne: string
  explication: string
  confiance: number
  zone?: Zone
}

function estObjet(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === 'object' && valeur !== null
}

function interpreterAnnotation(item: unknown): Annotation | null {
  if (!estObjet(item)) return null
  const annotation = texteAssaini(item.annotation, '')
  if (!annotation) return null // nothing to diagnose on an empty annotation
  const ligne = texteAssaini(item.ligne, '', MAX_LONGUEUR_LIGNE)
  const eleve = texteOptionnelAssaini(item.eleve)
  const attendu = texteOptionnelAssaini(item.attendu)
  const zone = zoneAssainie(item.zone)
  return {
    ligne,
    annotation,
    ...(eleve ? { eleve } : {}),
    ...(attendu ? { attendu } : {}),
    ...(zone ? { zone } : {}),
  }
}

function interpreterErreur(item: unknown): ErreurBrute | null {
  if (!estObjet(item)) return null
  const zone = zoneAssainie(item.zone)
  return {
    code: typeof item.code === 'string' ? item.code : '',
    ligne: texteAssaini(item.ligne, '', MAX_LONGUEUR_LIGNE),
    explication: texteAssaini(item.explication, ''),
    confiance: confianceAssainie(item.confiance),
    ...(zone ? { zone } : {}),
  }
}

function interpreterFusionnee(item: unknown): AnnotationFusionnee | null {
  const annotation = interpreterAnnotation(item)
  const erreur = interpreterErreur(item)
  if (!annotation || !erreur) return null
  return { ...annotation, code: erreur.code, confiance: erreur.confiance, explication: erreur.explication }
}

/** Schemas kept for tests and documentation of the contract. */
export const schemaAnnotation = z.unknown().transform(interpreterAnnotation)
export const schemaErreurBrute = z.unknown().transform(interpreterErreur)

function objetBrut(texte: string, quoi: string): Record<string, unknown> {
  const json = extraireJson(texte)
  if (!estObjet(json) || Array.isArray(json)) {
    throw new ErreurLLM(`Invalid model response (${quoi}): JSON object expected.`, 502)
  }
  return json
}

function copiePropreDe(brut: Record<string, unknown>, annotations: unknown[]): boolean {
  // A paper with no usable annotation is a clean paper, even if the model says
  // otherwise: this is the RNF-04 guarantee (zero false positives).
  return annotations.length === 0 || brut.copiePropre === true
}

export function parserExtraction(texte: string): Extraction {
  const brut = objetBrut(texte, 'extraction')
  const annotations = plafonner(listeTolerante(brut.annotations, interpreterAnnotation), MAX_ANNOTATIONS)
  const nomDetecte = texteOptionnelAssaini(brut.nomDetecte)
  return {
    annotations,
    copiePropre: copiePropreDe(brut, annotations),
    ...(nomDetecte ? { nomDetecte } : {}),
  }
}

export function parserAnalyse(texte: string): {
  annotations: AnnotationFusionnee[]
  copiePropre: boolean
  nomDetecte?: string
} {
  const brut = objetBrut(texte, 'analyse')
  const annotations = plafonner(listeTolerante(brut.annotations, interpreterFusionnee), MAX_ANNOTATIONS)
  const nomDetecte = texteOptionnelAssaini(brut.nomDetecte)
  return {
    annotations,
    copiePropre: copiePropreDe(brut, annotations),
    ...(nomDetecte ? { nomDetecte } : {}),
  }
}

export function parserClassification(texte: string): ErreurBrute[] {
  const brut = objetBrut(texte, 'classification')
  return plafonner(listeTolerante(brut.erreurs, interpreterErreur), MAX_ANNOTATIONS)
}

const schemaExercice = z.object({
  enonce: z.unknown(),
  indices: z.unknown(),
  solution: z.unknown(),
  typeTravaille: z.unknown(),
  niveau: z.unknown(),
})

export type ExerciceBrut = {
  enonce: string
  indices: string[]
  solution: string
  typeTravaille: string
  niveau: string
}

export function parserExercice(texte: string): ExerciceBrut {
  const brut = objetBrut(texte, 'exercice')
  const valide = schemaExercice.safeParse(brut)
  const source = (valide.success ? valide.data : brut) as Record<string, unknown>
  const enonce = texteAssaini(source.enonce, '')
  const solution = texteAssaini(source.solution, '')
  if (!enonce || !solution) {
    throw new ErreurLLM('Invalid model response (exercise): missing prompt or solution.', 502)
  }
  const indices = plafonner(
    listeTolerante(source.indices, (item) => (typeof item === 'string' && item.trim() ? item.trim() : null)),
    4,
  )
  const niveau = texteAssaini(source.niveau, 'high school', 60)
  return { enonce, indices, solution, typeTravaille: texteAssaini(source.typeTravaille, '', 10), niveau }
}

const schemaVerdict = z.object({
  travailleLeBonType: z.unknown(),
  neDonneLaSolutionOrigine: z.unknown(),
  memeNiveau: z.unknown(),
  motifs: z.unknown(),
})

export function parserVerdict(texte: string): VerdictGardeFou {
  const brut = objetBrut(texte, 'garde-fou')
  const valide = schemaVerdict.safeParse(brut)
  const source = (valide.success ? valide.data : brut) as Record<string, unknown>
  // A missing or unreadable verdict is a REFUSAL: we never serve an exercise
  // whose relevance could not be verified.
  return {
    travailleLeBonType: source.travailleLeBonType === true,
    neDonneLaSolutionOrigine: source.neDonneLaSolutionOrigine === true,
    memeNiveau: source.memeNiveau === true,
    motifs: plafonner(
      listeTolerante(source.motifs, (item) => (typeof item === 'string' && item.trim() ? item.trim() : null)),
      5,
    ),
  }
}

const schemaRevue = z.object({ fautes: z.unknown() })

export type FauteRevue = { index: number; code: string; confiance: number; explication: string; decision: string }

export function parserRevue(texte: string): FauteRevue[] {
  const brut = objetBrut(texte, 'revue')
  schemaRevue.parse(brut)
  return plafonner(
    listeTolerante(brut.fautes, (item): FauteRevue | null => {
      if (!estObjet(item)) return null
      const index = Number(item.index)
      if (!Number.isInteger(index) || index < 0) return null
      return {
        index,
        code: typeof item.code === 'string' ? item.code : '',
        confiance: confianceAssainie(item.confiance),
        explication: texteAssaini(item.explication, ''),
        decision: texteAssaini(item.decision, '', 20),
      }
    }),
    MAX_ANNOTATIONS,
  )
}
