import { defineConfig } from 'vitest/config'

// Pure-logic tests: domain, pipeline (with simulated client), proxy quota,
// exports. No network, no DOM.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts', 'api/**/*.test.ts'],
    exclude: ['tests/live/**'],
  },
})
