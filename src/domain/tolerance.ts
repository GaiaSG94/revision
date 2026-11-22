/**
 * Input tolerance — crash test of 12/11.
 *
 * A third-party model can return anything. Chosen rule: **bound and sanitize,
 * never reject wholesale**. Before this module, a single malformed annotation
 * (a zone with `NaN`) made the whole response fail parsing, losing an entire
 * paper over a detail. Each value is now sanitized individually, and lists and
 * texts are capped so the UI cannot freeze.
 */
import { MAX_LONGUEUR_LIGNE, MAX_LONGUEUR_TEXTE } from './config'
import type { Zone } from './types'

export function borne01(valeur: number): number {
  return Math.min(1, Math.max(0, valeur))
}

/** Truncates cleanly, marking the cut. */
export function tronquer(texte: string, max: number): string {
  if (texte.length <= max) return texte
  return `${texte.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

export function texteAssaini(valeur: unknown, repli: string, max = MAX_LONGUEUR_TEXTE): string {
  if (typeof valeur !== 'string') return repli
  const propre = valeur.trim()
  return propre.length === 0 ? repli : tronquer(propre, max)
}

export function texteOptionnelAssaini(valeur: unknown): string | undefined {
  if (typeof valeur !== 'string') return undefined
  const propre = valeur.trim()
  return propre.length === 0 ? undefined : tronquer(propre, MAX_LONGUEUR_LIGNE)
}

export function nombreAssaini(valeur: unknown, repli = 0): number {
  const nombre = typeof valeur === 'string' ? Number(valeur) : valeur
  return typeof nombre === 'number' && Number.isFinite(nombre) ? nombre : repli
}

/** Confidence bounded to [0,1]; any absurd value falls back to 0. */
export function confianceAssainie(valeur: unknown): number {
  return borne01(nombreAssaini(valeur, 0))
}

/**
 * Sanitized zone: finite numbers only, brought into [0,1], positive width and
 * height contained in the image. Returns `undefined` if the zone is unusable —
 * the annotation remains valid, only the highlight is lost.
 */
export function zoneAssainie(valeur: unknown): Zone | undefined {
  if (typeof valeur !== 'object' || valeur === null) return undefined
  const brute = valeur as Record<string, unknown>
  const x = nombreAssaini(brute.x, Number.NaN)
  const y = nombreAssaini(brute.y, Number.NaN)
  const largeur = nombreAssaini(brute.largeur, Number.NaN)
  const hauteur = nombreAssaini(brute.hauteur, Number.NaN)
  if (![x, y, largeur, hauteur].every((v) => Number.isFinite(v))) return undefined

  const xBorne = borne01(Math.min(x, x + largeur))
  const yBorne = borne01(Math.min(y, y + hauteur))
  const largeurBornee = Math.min(borne01(Math.abs(largeur)), 1 - xBorne)
  const hauteurBornee = Math.min(borne01(Math.abs(hauteur)), 1 - yBorne)
  if (largeurBornee <= 0 || hauteurBornee <= 0) return undefined
  return { x: xBorne, y: yBorne, largeur: largeurBornee, hauteur: hauteurBornee }
}

/**
 * Interprets a list element by element: an unusable element is discarded, it
 * does not make the whole response fail.
 */
export function listeTolerante<T>(valeur: unknown, interpreter: (item: unknown) => T | null): T[] {
  if (!Array.isArray(valeur)) return []
  const resultat: T[] = []
  for (const item of valeur) {
    const interprete = interpreter(item)
    if (interprete !== null && interprete !== undefined) resultat.push(interprete)
  }
  return resultat
}

/** Caps a list: beyond the limit, we keep the beginning (the UI flags it). */
export function plafonner<T>(liste: T[], max: number): T[] {
  return liste.length <= max ? liste : liste.slice(0, max)
}
