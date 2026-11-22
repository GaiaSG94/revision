/**
 * Proxy quota — pure logic, no dependency, no I/O.
 *
 * Two caps: per visitor over a sliding hour, and a global daily cap (InferHub's
 * free tier is shared). Everything is in memory: a restart resets the counters,
 * which is acceptable for a demo safeguard and avoids any server-side storage
 * (RNF-P1).
 */

export type OptionsQuota = {
  parIpParHeure?: number
  globalParJour?: number
  fenetreMs?: number
  jourMs?: number
}

export type Quota = {
  /** Consumes one unit if possible: true = allowed. */
  autoriser: (id: string, maintenant: number) => boolean
  /** Number of calls remaining for this id, without consuming. */
  restant: (id: string, maintenant: number) => number
}

const PAR_IP_PAR_HEURE = 20
const GLOBAL_PAR_JOUR = 200
const HEURE_MS = 60 * 60 * 1000
const JOUR_MS = 24 * HEURE_MS

function nettoyer(fenetre: number[], maintenant: number, fenetreMs: number): number[] {
  return fenetre.filter((instant) => maintenant - instant < fenetreMs)
}

export function creerQuota(options: OptionsQuota = {}): Quota {
  const parIp = options.parIpParHeure ?? PAR_IP_PAR_HEURE
  const globalParJour = options.globalParJour ?? GLOBAL_PAR_JOUR
  const fenetreMs = options.fenetreMs ?? HEURE_MS
  const jourMs = options.jourMs ?? JOUR_MS

  const historique = new Map<string, number[]>()
  let debutJour = 0
  let utiliseGlobal = 0

  function restantGlobal(maintenant: number): number {
    if (maintenant - debutJour >= jourMs) {
      debutJour = maintenant
      utiliseGlobal = 0
    }
    return Math.max(0, globalParJour - utiliseGlobal)
  }

  return {
    autoriser(id, maintenant) {
      const fenetre = nettoyer(historique.get(id) ?? [], maintenant, fenetreMs)
      if (fenetre.length >= parIp || restantGlobal(maintenant) <= 0) {
        historique.set(id, fenetre)
        return false
      }
      fenetre.push(maintenant)
      historique.set(id, fenetre)
      utiliseGlobal += 1
      return true
    },
    restant(id, maintenant) {
      const fenetre = nettoyer(historique.get(id) ?? [], maintenant, fenetreMs)
      return Math.max(0, Math.min(parIp - fenetre.length, restantGlobal(maintenant)))
    },
  }
}
