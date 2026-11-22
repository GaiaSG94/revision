import { useCallback, useRef, useState } from 'react'
import type { TouchEvent as ReactTouchEvent, WheelEvent as ReactWheelEvent } from 'react'
import type { Erreur } from '../../domain/types'
import { Bouton } from './Bouton'
import { ZoneFaute } from './ZoneFaute'
import type { Vue } from '../hooks/useZoom'
import { PAS_ZOOM, centrerSurZone, reinitialiser, zoomer } from '../hooks/useZoom'

type Props = {
  src: string
  alt: string
  erreurs: Erreur[]
  selection: number | null
  onSelect: (index: number | null) => void
}

function distanceTouches(evenement: ReactTouchEvent): number | null {
  const [a, b] = [evenement.touches[0], evenement.touches[1]]
  if (!a || !b) return null
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

/**
 * The annotated paper, interactive: clicking an error zooms in on it, clicking
 * a zone on the image selects the error in the list. Mouse wheel and
 * double-click on desktop, two-finger pinch on mobile. The frame bounds the
 * view: the image never leaves the screen.
 */
export function CopieAnnotee({ src, alt, erreurs, selection, onSelect }: Props) {
  const [vue, setVue] = useState<Vue>(reinitialiser)
  const derniereDistance = useRef<number | null>(null)

  const zoomerSur = useCallback(
    (index: number) => {
      onSelect(index)
      const zone = erreurs[index]?.zone
      if (zone) setVue(centrerSurZone(zone))
    },
    [erreurs, onSelect],
  )

  const surMolette = (evenement: ReactWheelEvent) => {
    setVue((precedente) => zoomer(precedente, evenement.deltaY < 0 ? PAS_ZOOM : -PAS_ZOOM))
  }

  const surTactile = (evenement: ReactTouchEvent) => {
    const distance = distanceTouches(evenement)
    if (distance === null) {
      derniereDistance.current = null
      return
    }
    const precedente = derniereDistance.current
    derniereDistance.current = distance
    if (precedente && precedente > 0) setVue((v) => zoomer(v, ((distance - precedente) / precedente) * 2))
  }

  return (
    <div className="space-y-2">
      <div
        className="relative overflow-hidden rounded-lg border border-bord bg-fond"
        style={{ touchAction: 'none' }}
        onWheel={surMolette}
        onTouchStart={surTactile}
        onTouchMove={surTactile}
        onDoubleClick={() => setVue((v) => (v.echelle > 1 ? reinitialiser() : zoomer(v, PAS_ZOOM * 2)))}
      >
        <div
          className="relative transition-transform duration-150 ease-out"
          style={{ transform: `translate(${vue.x}%, ${vue.y}%) scale(${vue.echelle})` }}
        >
          <img src={src} alt={alt} className="block max-h-[50vh] w-full object-contain" draggable={false} />
          {erreurs.map((erreur, index) =>
            erreur.zone ? (
              <ZoneFaute
                key={index}
                index={index}
                code={erreur.code}
                zone={erreur.zone}
                selectionne={selection === index}
                onSelect={zoomerSur}
              />
            ) : null,
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-xs text-muet">zoom ×{vue.echelle.toFixed(1)}</span>
        {vue.echelle > 1 ? (
          <Bouton variante="discret" onClick={() => setVue(reinitialiser())}>
            Reset zoom
          </Bouton>
        ) : (
          <span className="text-xs text-muet">Click a mistake to zoom in on it.</span>
        )}
      </div>
    </div>
  )
}
