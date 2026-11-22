import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Vite does not ship Node types: declare the only useful access.
declare const process: { env: Record<string, string | undefined> }

// Static webapp: the build goes to dist/, served by GitHub Pages (or any
// static host). No secret variable enters the bundle: the InferHub key lives
// in the proxy (`api/`).
export default defineConfig({
  // GitHub Pages serves the site under /revision/; locally and on a root host,
  // the base stays '/'. The pages.yml workflow sets VITE_BASE=/revision/.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), tailwindcss()],
  build: {
    target: 'es2022',
    sourcemap: false,
    // RNF-07: initial bundle < 300 KB gzip. Split the React base so the home
    // screen (the only screen of the first render) stays light.
    rollupOptions: {
      output: {
        manualChunks: { vendor: ['react', 'react-dom'] },
      },
    },
  },
})
