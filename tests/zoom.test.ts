import { describe, expect, it } from 'vitest'
import {
  ECHELLE_MAX,
  ECHELLE_MIN,
  borner,
  centrerSurZone,
  clamp,
  reinitialiser,
  zoomer,
} from '../src/ui/hooks/useZoom'

describe('zoom and reframing (batch 7)', () => {
  it('clamp stays within bounds', () => {
    expect(clamp(5, 1, 4)).toBe(4)
    expect(clamp(-3, 1, 4)).toBe(1)
    expect(clamp(2, 1, 4)).toBe(2)
  })

  it('reinitialiser returns a neutral view', () => {
    expect(reinitialiser()).toEqual({ echelle: 1, x: 0, y: 0 })
  })

  it('centering a full-frame zone moves nothing', () => {
    const vue = centrerSurZone({ x: 0, y: 0, largeur: 1, hauteur: 1 }, 2)
    expect(vue.echelle).toBe(2)
    expect(Math.abs(vue.x)).toBeLessThan(0.001)
    expect(Math.abs(vue.y)).toBeLessThan(0.001)
  })

  it('centering a top-left zone is bounded (the image stays in the frame)', () => {
    const vue = centrerSurZone({ x: 0, y: 0, largeur: 0.2, hauteur: 0.04 }, 2)
    const limite = (vue.echelle - 1) * 50
    expect(vue.x).toBeLessThanOrEqual(limite)
    expect(vue.x).toBeGreaterThanOrEqual(-limite)
    expect(vue.y).toBeLessThanOrEqual(limite)
  })

  it('borner brings an excessive translation back into the frame', () => {
    const vue = borner({ echelle: 2, x: 900, y: -900 })
    expect(vue.x).toBe(50)
    expect(vue.y).toBe(-50)
  })

  it('the scale stays between min and max, whatever is requested', () => {
    expect(borner({ echelle: 99, x: 0, y: 0 }).echelle).toBe(ECHELLE_MAX)
    expect(borner({ echelle: 0.1, x: 0, y: 0 }).echelle).toBe(ECHELLE_MIN)
    expect(zoomer({ echelle: 3.9, x: 0, y: 0 }, 1).echelle).toBe(ECHELLE_MAX)
    expect(zoomer({ echelle: 1.2, x: 0, y: 0 }, -1).echelle).toBe(ECHELLE_MIN)
  })

  it('a degenerate zone (width 0, out-of-frame coordinates) does not break', () => {
    const vue = centrerSurZone({ x: 5, y: -3, largeur: 0, hauteur: 0 }, 2)
    expect(Number.isFinite(vue.x)).toBe(true)
    expect(Number.isFinite(vue.y)).toBe(true)
    expect(vue.echelle).toBe(2)
  })

  it('zoomer keeps the framing within bounds at every step', () => {
    let vue = reinitialiser()
    for (let i = 0; i < 10; i += 1) {
      vue = zoomer(vue, 0.5)
      const limite = (vue.echelle - 1) * 50
      expect(Math.abs(vue.x)).toBeLessThanOrEqual(limite + 0.001)
      expect(Math.abs(vue.y)).toBeLessThanOrEqual(limite + 0.001)
    }
  })
})