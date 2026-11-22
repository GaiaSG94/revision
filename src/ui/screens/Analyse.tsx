import { BUDGET_PIPELINE_MS } from '../../domain/config'
import { Bouton } from '../components/Bouton'
import { EtapesPipeline } from '../components/EtapesPipeline'
import { Carte } from '../components/Carte'
import { origineDemo } from '../../pipeline/demo'
import { useRature } from '../../etat/useRevision'

/**
 * Screen 3: the normal progress of the six steps. We do not show a silent
 * spinner: waiting becomes a demonstration of the pipeline (Presentation
 * criterion), and the announced budget is the one from the spec.
 */
export function Analyse() {
  const {
    progression,
    erreur,
    occupe,
    aller,
    messageProgres,
    modeleRepondu,
    demoId,
    reprendreAnalyse,
    dernierFichier,
    analyserDemo,
  } = useRature()
  const demo = demoId ? origineDemo(demoId) : null
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold tracking-tight">Analysis in progress</h1>
      <p className="text-sm text-muet">
        Announced budget: under {(BUDGET_PIPELINE_MS / 1000).toFixed(0)}s from photo to diagnosis.
        The paper is sent only for this processing, then forgotten.
      </p>

      {demo ? (
        <p className="rounded-lg border border-bord bg-surface-2 px-3 py-2 text-xs text-muet">
          Demo replay — answers recorded on {demo.enregistreLe.slice(0, 10)} with {demo.modele}.
          Each step waits the timing actually measured during the recording.
        </p>
      ) : null}

      <Carte>
        <EtapesPipeline progression={progression} />
      </Carte>

      <div className="text-center">
        <Bouton variante="discret" onClick={() => aller('accueil')}>
          Continue without waiting — a badge will tell me when it's ready
        </Bouton>
      </div>

      {messageProgres ? (
        <p className="rounded-lg border border-bord bg-surface-2 px-3 py-2 font-mono text-xs text-muet">
          {messageProgres}
        </p>
      ) : null}

      {modeleRepondu ? (
        <p className="text-xs text-muet">Answered by {modeleRepondu.split('/').pop()}</p>
      ) : null}

      {erreur && !occupe ? (
        <div role="alert" className="space-y-3 rounded-xl border border-jaune/60 bg-surface-2 p-4">
          <p className="text-sm text-jaune">{erreur}</p>
          <div className="flex flex-wrap gap-3">
            {dernierFichier ? (
              <Bouton variante="secondaire" onClick={() => void reprendreAnalyse()}>
                Try again
              </Bouton>
            ) : null}
            <Bouton variante="discret" onClick={() => void analyserDemo()}>
              Run the offline demo (recorded answers, no network)
            </Bouton>
          </div>
        </div>
      ) : null}
      {!occupe && !erreur ? <p className="text-sm text-muet">Loading the result…</p> : null}
    </div>
  )
}
