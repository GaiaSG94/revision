import { Accueil } from './screens/Accueil'
import { CommentCaMarche } from './screens/CommentCaMarche'
import { Analyse } from './screens/Analyse'
import { Cadrage } from './screens/Cadrage'
import { Diagnostic } from './screens/Diagnostic'
import { Exemples } from './screens/Exemples'
import { Exercice } from './screens/Exercice'
import { Prof } from './screens/Prof'
import { Profil } from './screens/Profil'
import { Reglages } from './screens/Reglages'
import { Entete } from './components/Entete'
import { useRature } from '../etat/useRevision'
import type { Ecran } from '../etat/useRevision'
import { useEffect } from 'react'
import type { JSX } from 'react'

const ECRANS: Record<Ecran, () => JSX.Element> = {
  accueil: Accueil,
  cadrage: Cadrage,
  analyse: Analyse,
  diagnostic: Diagnostic,
  exemples: Exemples,
  profil: Profil,
  exercice: Exercice,
  prof: Prof,
  reglages: Reglages,
  apropos: CommentCaMarche,
}

/**
 * The dot grid reacts to the pointer: two layers shift in opposite directions
 * (parallax). Damping (0.08) makes the tracking smooth, never jerky; motion is
 * disabled if the user requests reduced motion.
 */
function useParallaxeTrame() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let x = window.innerWidth / 2
    let y = window.innerHeight / 2
    let cibleX = x
    let cibleY = y
    let raf = 0
    const bouge = () => {
      x += (cibleX - x) * 0.08
      y += (cibleY - y) * 0.08
      const racine = document.documentElement.style
      racine.setProperty('--px', `${((x / window.innerWidth - 0.5) * -30).toFixed(1)}px`)
      racine.setProperty('--py', `${((y / window.innerHeight - 0.5) * -22).toFixed(1)}px`)
      const reste = Math.abs(cibleX - x) > 0.5 || Math.abs(cibleY - y) > 0.5
      raf = reste ? requestAnimationFrame(bouge) : 0
    }
    const surMouvement = (evenement: PointerEvent) => {
      cibleX = evenement.clientX
      cibleY = evenement.clientY
      if (!raf) raf = requestAnimationFrame(bouge)
    }
    window.addEventListener('pointermove', surMouvement, { passive: true })
    return () => {
      window.removeEventListener('pointermove', surMouvement)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])
}

/** Home-grown router: one state, eight screens, no external dependency. */
const ETIQUETTES_SANTE = {
  ok: 'model online',
  ko: 'model unavailable',
  inconnue: 'model not probed',
} as const

export function Application() {
  const { ecran, santeProxy } = useRature()
  useParallaxeTrame()
  const EcranActif = ECRANS[ecran]
  return (
    <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-[1500px] flex-col px-4 py-5 sm:px-7 lg:px-10">
      <Entete />
      <main className="revision-zone flex-1">
        <EcranActif />
      </main>
      <footer className="mt-6 px-1 text-xs text-white/85">
        No paper is ever stored · local history ·{' '}
        <span
          aria-label={ETIQUETTES_SANTE[santeProxy]}
          title={ETIQUETTES_SANTE[santeProxy]}
          className={
            santeProxy === 'ko'
              ? 'text-ambre'
              : santeProxy === 'ok'
                ? 'text-menthe'
                : 'text-white/70'
          }
        >
          ● {ETIQUETTES_SANTE[santeProxy]}
        </span>
      </footer>
    </div>
  )
}
