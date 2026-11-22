/**
 * Zoom and reframing of the paper — batch 7. **Pure** logic (no DOM) so it can
 * be tested in Node; the component only applies the CSS transform.
 *
 * Convention: `transform: translate(x%, y%) scale(e)`. Translation percentages
 * are relative to the UNscaled size of the image, so a point in relative
 * coordinates (cx, cy) is recentred by setting x = (0.5 − cx) × e × 100, bounded
 * so the image never leaves the frame.
 */
import type { Zone } from '../../domain/types'

export type Vue = { echelle: number; x: number; y: number }

export const ECHELLE_MIN = 1
export const ECHELLE_MAX = 4
export const ECHELLE_CIBLE_ZONE = 2.5
export const PAS_ZOOM = 0.5

export function clamp(valeur: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, valeur))
}

export function reinitialiser(): Vue {
  return { echelle: 1, x: 0, y: 0 }
}

/** Maximum translation (in %) so the image always fills the frame. */
function limite(echelle: number): number {
  return (echelle - 1) * 50
}

/** Brings the view back into the frame: bounded scale, bounded translation. */
export function borner(vue: Vue): Vue {
  const echelle = clamp(vue.echelle, ECHELLE_MIN, ECHELLE_MAX)
  const max = limite(echelle)
  return { echelle, x: clamp(vue.x, -max, max), y: clamp(vue.y, -max, max) }
}

/** Centres a zone (relative coordinates 0..1) at the target scale. */
export function centrerSurZone(zone: Zone, echelleCible = ECHELLE_CIBLE_ZONE): Vue {
  const echelle = clamp(echelleCible, ECHELLE_MIN, ECHELLE_MAX)
  const cx = clamp(zone.x + zone.largeur / 2, 0, 1)
  const cy = clamp(zone.y + zone.hauteur / 2, 0, 1)
  return borner({ echelle, x: (0.5 - cx) * echelle * 100, y: (0.5 - cy) * echelle * 100 })
}

/** Zoom in/out around the centre, bounded. */
export function zoomer(vue: Vue, delta: number): Vue {
  return borner({ ...vue, echelle: vue.echelle + delta })
}
