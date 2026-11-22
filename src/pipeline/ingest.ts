/**
 * Step 1 — Ingest: photo file → normalized image (resized, contrast stretched).
 * Target < 300 ms and a reasonable upload size.
 *
 * No disk write, no network send here: the image lives in memory until the
 * extraction step, then is forgotten (RNF-P1).
 */
import { LARGEUR_CIBLE_IMAGE, TAILLE_MAX_IMAGE_OCTETS } from '../domain/config'
import { ErreurLLM } from './llm'

export type ImageNormalisee = { dataUrl: string; largeur: number; hauteur: number }

export type OptionsIngest = { largeurCible?: number; qualite?: number; contraste?: boolean }

const TAILLE_MAX_MO = Math.round(TAILLE_MAX_IMAGE_OCTETS / (1024 * 1024))

export function verifierTaille(octets: number): void {
  if (octets > TAILLE_MAX_IMAGE_OCTETS) {
    throw new ErreurLLM(
      `Photo too large (max ${TAILLE_MAX_MO} MB). Retake it at normal quality.`,
      413,
    )
  }
  if (octets === 0) throw new ErreurLLM('Empty file: choose a photo of your paper.', 400)
}

/** Reduces the width to the target while keeping proportions (never enlarges). */
export function calculerDimensions(
  largeur: number,
  hauteur: number,
  cible: number,
): { largeur: number; hauteur: number } {
  if (largeur <= cible) return { largeur, hauteur }
  const ratio = cible / largeur
  return { largeur: cible, hauteur: Math.max(1, Math.round(hauteur * ratio)) }
}

/**
 * Level stretching over the [low, high] luminance range (2% / 98%): a paper
 * photo taken with a phone is often dull, which drowns out the teacher's
 * pencil. In-place operation on the RGBA pixels.
 */
export function etirerNiveaux(donnees: Uint8ClampedArray): void {
  const histogramme = new Uint32Array(256)
  for (let i = 0; i < donnees.length; i += 4) {
    const lum = Math.round(0.299 * donnees[i]! + 0.587 * donnees[i + 1]! + 0.114 * donnees[i + 2]!)
    histogramme[lum]! += 1
  }
  const total = donnees.length / 4
  const bas = percentile(histogramme, total, 0.02)
  const haut = percentile(histogramme, total, 0.98)
  if (haut - bas < 16) return // already contrasted or uniform image: break nothing
  const facteur = 255 / (haut - bas)
  for (let i = 0; i < donnees.length; i += 4) {
    donnees[i] = (donnees[i]! - bas) * facteur
    donnees[i + 1] = (donnees[i + 1]! - bas) * facteur
    donnees[i + 2] = (donnees[i + 2]! - bas) * facteur
  }
}

/** Luminance index below which the `part` fraction of pixels lies. */
function percentile(histogramme: Uint32Array, total: number, part: number): number {
  const seuil = total * part
  let cumul = 0
  for (let niveau = 0; niveau < histogramme.length; niveau += 1) {
    cumul += histogramme[niveau]!
    if (cumul >= seuil) return niveau
  }
  return 0
}

async function chargerBitmap(fichier: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(fichier)
  } catch {
    throw new ErreurLLM('Unreadable image: try again with a JPG or PNG photo.', 415)
  }
}

export async function normaliserImage(
  fichier: File,
  options: OptionsIngest = {},
): Promise<ImageNormalisee> {
  verifierTaille(fichier.size)
  const bitmap = await chargerBitmap(fichier)
  const { largeur, hauteur } = calculerDimensions(
    bitmap.width,
    bitmap.height,
    options.largeurCible ?? LARGEUR_CIBLE_IMAGE,
  )

  const canvas = document.createElement('canvas')
  canvas.width = largeur
  canvas.height = hauteur
  const contexte = canvas.getContext('2d', { willReadFrequently: true })
  if (!contexte) throw new ErreurLLM('Canvas unavailable in this browser.', 500)

  contexte.drawImage(bitmap, 0, 0, largeur, hauteur)
  bitmap.close()

  if (options.contraste !== false) {
    const image = contexte.getImageData(0, 0, largeur, hauteur)
    etirerNiveaux(image.data)
    contexte.putImageData(image, 0, 0)
  }

  return {
    dataUrl: canvas.toDataURL('image/jpeg', options.qualite ?? 0.85),
    largeur,
    hauteur,
  }
}
