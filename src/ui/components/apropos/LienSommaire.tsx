type Props = { ancre: string; titre: string }

/** Internal table-of-contents link: a `#` anchor to a section on the same screen. */
export function LienSommaire({ ancre, titre }: Props) {
  return (
    <a
      href={`#${ancre}`}
      className="text-sm text-jaune underline underline-offset-4 hover:brightness-110"
    >
      {titre}
    </a>
  )
}
