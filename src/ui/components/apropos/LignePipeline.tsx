/** Fact sheet for a pipeline step: what goes in, what comes out, what it costs. */
export type FicheEtape = {
  entree: string
  sortie: string
  /** Actually measured latency (corpus + public demo), not a promise. */
  latence: string
  note?: string
}

type Props = { ordre: number; libelle: string; fiche: FicheEtape }

/**
 * A pipeline row. The label comes from `ETAPES` (single source), the fact sheet
 * is the documentation part: input/output contract and measured time.
 */
export function LignePipeline({ ordre, libelle, fiche }: Props) {
  return (
    <li className="rounded-xl border border-bord bg-surface-2 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold text-texte">
          <span className="mr-2 font-mono text-jaune" aria-hidden="true">
            {ordre}
          </span>
          {libelle}
        </h3>
        <span className="rounded-full border border-vert/50 px-2 py-0.5 font-mono text-xs text-vert">
          {fiche.latence}
        </span>
      </div>
      <dl className="mt-2 space-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="shrink-0 text-muet">Input</dt>
          <dd className="text-texte/90">{fiche.entree}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-muet">Output</dt>
          <dd className="text-texte/90">{fiche.sortie}</dd>
        </div>
      </dl>
      {fiche.note ? <p className="mt-2 text-xs text-muet">{fiche.note}</p> : null}
    </li>
  )
}
