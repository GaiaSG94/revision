import { describe, expect, it } from 'vitest'
import { creerQuota } from './_quota'

const T0 = 1_700_000_000_000
const HEURE = 60 * 60 * 1000

describe('proxy quota', () => {
  it('allows up to the per-visitor cap, then refuses', () => {
    const quota = creerQuota({ parIpParHeure: 3, globalParJour: 100 })
    expect(quota.autoriser('a', T0)).toBe(true)
    expect(quota.autoriser('a', T0 + 1)).toBe(true)
    expect(quota.autoriser('a', T0 + 2)).toBe(true)
    expect(quota.autoriser('a', T0 + 3)).toBe(false)
    expect(quota.restant('a', T0 + 3)).toBe(0)
  })

  it('isolates visitors from each other', () => {
    const quota = creerQuota({ parIpParHeure: 1, globalParJour: 100 })
    expect(quota.autoriser('a', T0)).toBe(true)
    expect(quota.autoriser('b', T0)).toBe(true)
    expect(quota.autoriser('a', T0)).toBe(false)
  })

  it('reopens the sliding window after an hour', () => {
    const quota = creerQuota({ parIpParHeure: 1, globalParJour: 100 })
    expect(quota.autoriser('a', T0)).toBe(true)
    expect(quota.autoriser('a', T0 + HEURE + 1)).toBe(true)
  })

  it('applies the global cap even below the individual cap', () => {
    const quota = creerQuota({ parIpParHeure: 10, globalParJour: 2 })
    expect(quota.autoriser('a', T0)).toBe(true)
    expect(quota.autoriser('b', T0)).toBe(true)
    expect(quota.autoriser('c', T0)).toBe(false)
  })

  it('resets the global counter when the day changes', () => {
    const quota = creerQuota({ parIpParHeure: 10, globalParJour: 1 })
    expect(quota.autoriser('a', T0)).toBe(true)
    expect(quota.autoriser('b', T0)).toBe(false)
    expect(quota.autoriser('b', T0 + 24 * HEURE + 1)).toBe(true)
  })

  it('an unknown id has its full quota', () => {
    const quota = creerQuota({ parIpParHeure: 5, globalParJour: 50 })
    expect(quota.restant('inconnu', T0)).toBe(5)
  })
})
