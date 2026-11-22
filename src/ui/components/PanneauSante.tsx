import { useState } from 'react'
import { autoVerifier } from '../../pipeline/diagnostic'
import type { Controle } from '../../pipeline/diagnostic'
import { transportDe } from '../../etat/useEtatRevision'
import { useRature } from '../../etat/useRevision'
import { Bouton } from './Bouton'

/**
 * Self-check panel: one click runs real checks and shows **one proof per
 * subsystem**. This is the "show, don't tell" version of the "How it works"
 * page: a judge can verify the app live, without a key.
 */
export function PanneauSante() {
  const { reglages } = useRature()
  const [controles, setControles] = useState<Controle[] | null>(null)
  const [enCours, setEnCours] = useState(false)

  const lancer = async () => {
    setEnCours(true)
    try {
      const proxy = transportDe(reglages).proxy
      setControles(await autoVerifier(proxy))
    } finally {
      setEnCours(false)
    }
  }

  const reussis = controles?.filter((controle) => controle.ok).length ?? 0

  return (
    <section className="rounded-2xl border border-bord bg-surface p-4">
      <h3 className="text-base font-semibold text-texte">Check everything works</h3>
      <p className="mt-1 text-sm text-muet">
        Seven real checks, using no quota: proxy, fallback chain, local cache, history, exercise
        bank, taxonomy, waiting budget. Each line shows the proof, not a checkmark.
      </p>

      <div className="mt-3">
        <Bouton onClick={() => void lancer()} disabled={enCours}>
          {enCours ? 'Checking…' : 'Run the check'}
        </Bouton>
      </div>

      {controles ? (
        <ul className="mt-4 space-y-2">
          <li className="text-xs text-muet">
            {reussis} check(s) passed out of {controles.length}.
          </li>
          {controles.map((controle) => (
            <li
              key={controle.nom}
              className="rounded-lg border border-bord bg-surface-2 px-3 py-2 text-xs"
            >
              <span className={controle.ok ? 'text-vert' : 'text-jaune'}>
                {controle.ok ? '✓' : '✗'} {controle.nom}
                {controle.ms !== undefined ? ` · ${controle.ms} ms` : ''}
              </span>
              <span className="block text-muet">{controle.preuve}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
