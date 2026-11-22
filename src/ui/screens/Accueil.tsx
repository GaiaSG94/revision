import { Bouton } from '../components/Bouton'
import { BandeauSante } from '../components/BandeauSante'
import { Carte } from '../components/Carte'
import { BoardDuo } from '../components/BoardDuo'
import { COPIES_DEMO, TOUR_DEMO } from '../../pipeline/demo'
import { useRature } from '../../etat/useRevision'

const TITRE = ['Turn', 'your', 'mistakes', 'into', 'moves'] as const

/**
 * V9 home (Design/revision/accueil-v9.html mockup, sections A + C):
 * corrected hero — three buttons on one line (amber / white / green), word-by-
 * word title with "moves" in amber — and right-hand block = C1 duo (live scan)
 * then C5 (phone). The paper gallery now lives on the "Sample papers" screen;
 * the small demo buttons at the bottom are gone: "Watch the demo" replaces them.
 */
export function Accueil() {
  const { aller, profil, analyserDemo, occupe } = useRature()
  const plusieurs = TOUR_DEMO.length > 1
  const copieGuidee = TOUR_DEMO.slice(0, 4)

  return (
    <div className="revision-home">
      <section className="revision-hero">
        <div className="revision-hero-copy">
          <p className="revision-hero-kicker">A study app for students who hate red pen.</p>
          <h1>
            {TITRE.map((mot) => (
              <span key={mot}>
                <span className={mot === 'moves' ? 'revision-titre-mot revision-moves' : 'revision-titre-mot'}>
                  {mot}
                </span>{' '}
              </span>
            ))}
          </h1>
          <p className="revision-hero-lede">
            Photograph your corrected paper. We read the teacher&apos;s marks, sort them by error type,
            and build the exercise that works on <em>your</em> weakness.
          </p>
          <div className="revision-ctas">
            <Bouton onClick={() => aller('cadrage')}>Photograph my paper</Bouton>
            {plusieurs ? (
              <Bouton variante="blanc" onClick={() => void analyserDemo(copieGuidee)} disabled={occupe}>
                Watch the demo
              </Bouton>
            ) : null}
            <Bouton variante="menthe" onClick={() => aller('exemples')}>
              Try a sample paper
            </Bouton>
          </div>
          <div className="revision-proof-stickers" aria-hidden="true">
            <span className="sticker sticker-rose">No grades. Ever.</span>
            <span className="sticker sticker-blanc">12 error types</span>
          </div>
        </div>

        <BoardDuo />
      </section>

      <div className="revision-home-lower">
        <BandeauSante />
        {profil.totalAnalyses > 0 ? (
          <Carte titre="Continue" ton="vert">
            <p className="text-sm text-muet">{profil.totalAnalyses} paper(s) analysed on this device.</p>
            <div className="mt-3">
              <Bouton variante="secondaire" onClick={() => aller('profil')}>
                See my error profile
              </Bouton>
            </div>
          </Carte>
        ) : null}
        <p className="text-center text-xs text-white/75">
          Model answers recorded on {COPIES_DEMO.length} sample paper(s) · replayable offline · no key
          · no paper ever stored.
        </p>
      </div>
    </div>
  )
}
