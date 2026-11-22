import { createRoot } from 'react-dom/client'
import { StrictMode } from 'react'
import './styles.css'
import './v9.css'
import { Application } from './ui/App'
import { RatureProvider } from './etat/useRevision'

const cible = document.getElementById('root')
if (!cible) throw new Error('Mount point #root missing from the document.')

createRoot(cible).render(
  <StrictMode>
    <RatureProvider>
      <Application />
    </RatureProvider>
  </StrictMode>,
)
