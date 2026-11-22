type Props = { titre: string; items: readonly string[]; ton?: 'jaune' | 'vert' }

const TONS: Record<NonNullable<Props['ton']>, string> = {
  jaune: 'border-jaune/50',
  vert: 'border-vert/50',
}

/**
 * Titled block + bulleted list: the repeated pattern of the documentation
 * sections. A single place for this rendering, so no markup is copied.
 */
export function BlocListe({ titre, items, ton = 'jaune' }: Props) {
  return (
    <div className={`rounded-xl border ${TONS[ton]} bg-surface-2 p-3`}>
      <h3 className="text-lg font-semibold text-texte">{titre}</h3>
      <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-muet">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  )
}
