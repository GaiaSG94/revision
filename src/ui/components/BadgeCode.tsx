import { libelleDe } from '../../domain/taxonomy'
import type { CodeErreur } from '../../domain/taxonomy'

type Props = { code: CodeErreur; confiance?: number }

/** Label for an error type: code + name + displayed confidence (§17). */
export function BadgeCode({ code, confiance }: Props) {
  const estNonTypee = code === 'E99'
  return (
    <span
      className={[
        'sticker text-xs',
        estNonTypee ? 'sticker-blanc' : 'sticker-ambre',
      ].join(' ')}
    >
      <span className="font-mono">{code}</span>
      <span>{libelleDe(code)}</span>
      {confiance !== undefined ? (
        <span className="font-mono text-[11px] opacity-70">{Math.round(confiance * 100)} %</span>
      ) : null}
    </span>
  )
}
