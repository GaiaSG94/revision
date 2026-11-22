import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import { profilVide } from '../domain/profil'
import { effacerHistorique } from '../storage/local'
import { useActionsRature } from './useActions'
import { useEtatRature } from './useEtatRevision'

export type { Ecran, Etat } from './useEtatRevision'
export { ECRANS, transportDe } from './useEtatRevision'

/**
 * Single provider: state comes from `useEtatRature`, actions from
 * `useActionsRature`. Screens only consume `useRature()`.
 */
export function RatureProvider({ children }: { children: ReactNode }) {
  const { etat, setEtat, aller } = useEtatRature()
  const actions = useActionsRature({ etat, setEtat, aller })

  const valeur = useMemo(() => ({ ...etat, aller, ...actions }), [etat, aller, actions])
  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>
}

type Valeur = ReturnType<typeof useEtatRature>['etat'] & {
  aller: (ecran: import('./useEtatRevision').Ecran) => void
} & ReturnType<typeof useActionsRature>

const Contexte = createContext<Valeur | null>(null)

export function useRature(): Valeur {
  const valeur = useContext(Contexte)
  if (!valeur) throw new Error('useRature must be used within <RatureProvider>.')
  return valeur
}

/** Reused by screens: full reset of the local history. */
export { effacerHistorique, profilVide }
