import { useEffect, useState } from 'react'

/**
 * Right-hand block of the hero (V9 mockup, section A): two scenes that follow
 * each other — C1 "Revision scans your paper" then C5 "You practise the habit"
 * — with two clickable tabs and an amber gauge under the active tab.
 *
 * The active tab drives everything: a click jumps straight to the desired
 * scene. `prefers-reduced-motion`: no auto-rotation (motion is cut globally in
 * styles.css), the tab remains usable by click.
 */

const DUREE_SCENE_MS = 6500

type Scene = 'scan' | 'habitude'

/** C1 — the paper passes under the scanner, errors are boxed one by one. */
function SceneScan() {
  return (
    <div className="revision-scan">
      <div className="revision-scan-labo">
        <span>Jordan · Test 3 · name hidden</span>
        <span>analysing…</span>
      </div>
      <div className="revision-scan-papier">
        <div className="revision-scan-ligne">f(x) = (2x − 3)² − (x + 1)(x − 1)</div>
        <div className="revision-scan-ligne">f(x) = 4x² − 9 − x² − 1</div>
        <div className="revision-scan-ligne">g′(x) = 6x e<sup>−x</sup> + (3x² − 1) e<sup>−x</sup></div>
        <div className="revision-scan-ligne">h(x) = −2x² − 6x − 2</div>
        <div className="revision-scan-faisceau" />
        <div className="revision-scan-cadre" style={{ left: '18%', top: '1.4rem', width: '7rem', height: '2.1rem', animationDelay: '1s' }}>
          <span className="sticker sticker-ambre">E03</span>
        </div>
        <div className="revision-scan-cadre" style={{ left: '26%', top: '4.3rem', width: '9rem', height: '2.1rem', animationDelay: '1.8s' }}>
          <span className="sticker sticker-ambre">E01</span>
        </div>
        <div className="revision-scan-cadre" style={{ left: '12%', top: '7.2rem', width: '7.5rem', height: '2.1rem', animationDelay: '2.6s' }}>
          <span className="sticker sticker-ambre">E01</span>
        </div>
      </div>
      <div className="revision-scan-etapes">
        {['1 normalize', '2 mask name', '3 read marks', '4 classify', '5 profile', '6 drill'].map(
          (etape, index) => (
            <span key={etape} style={{ animationDelay: `${index * 0.4}s` }}>
              {etape}
            </span>
          ),
        )}
      </div>
    </div>
  )
}

/** C5 — the product as the student sees it on mobile. */
function SceneHabitude() {
  return (
    <div className="revision-tel">
      <div className="revision-tel-appareil">
        <div className="revision-tel-encoche" />
        <div className="revision-tel-carte revision-tel-push">
          <b>Revision · this week</b>
          <small>Your habit: the sign before a bracket.</small>
        </div>
        <div className="revision-tel-carte">
          <span className="sticker sticker-ambre">E01 drill</span>
          <p className="revision-tel-question">Expand −4(x − 3)</p>
          <div className="revision-tel-reponse">
            <span>= −4x + 12</span>
          </div>
          <span className="revision-tel-ok">Got it ✓</span>
        </div>
        <div className="revision-tel-carte" style={{ fontSize: '0.7rem' }}>
          3 papers analysed · nothing stored
        </div>
      </div>
      <ol className="revision-tel-etapes">
        <li>
          <i>1</i>Snap the paper you already got back.
        </li>
        <li>
          <i>2</i>See the one mistake you keep making, with proof from your papers.
        </li>
        <li>
          <i>3</i>Fix it with one short drill, not a whole chapter.
        </li>
      </ol>
    </div>
  )
}

export function BoardDuo() {
  const [scene, setScene] = useState<Scene>('scan')
  const mouvementReduit = useMouvementReduit()

  useEffect(() => {
    if (mouvementReduit) return
    const minuteur = setInterval(
      () => setScene((actuelle) => (actuelle === 'scan' ? 'habitude' : 'scan')),
      DUREE_SCENE_MS,
    )
    return () => clearInterval(minuteur)
  }, [mouvementReduit])

  return (
    <div className="revision-duo" aria-label="How Revision works">
      <div className="revision-duo-onglets" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={scene === 'scan'}
          className={scene === 'scan' ? 'revision-duo-onglet est-actif' : 'revision-duo-onglet'}
          onClick={() => setScene('scan')}
        >
          1 · Revision scans your paper
          <i />
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={scene === 'habitude'}
          className={scene === 'habitude' ? 'revision-duo-onglet est-actif' : 'revision-duo-onglet'}
          onClick={() => setScene('habitude')}
        >
          2 · You practise the habit
          <i />
        </button>
      </div>
      <div className={scene === 'scan' ? 'revision-duo-scene est-active' : 'revision-duo-scene'}>
        <SceneScan />
      </div>
      <div className={scene === 'habitude' ? 'revision-duo-scene est-active' : 'revision-duo-scene'}>
        <SceneHabitude />
      </div>
    </div>
  )
}

/** Reduced motion stops the auto-rotation: read the media query state. */
function useMouvementReduit() {
  const [reduit, setReduit] = useState(false)
  useEffect(() => {
    const requete = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduit(requete.matches)
    const ecoute = (evenement: MediaQueryListEvent) => setReduit(evenement.matches)
    requete.addEventListener('change', ecoute)
    return () => requete.removeEventListener('change', ecoute)
  }, [])
  return reduit
}
