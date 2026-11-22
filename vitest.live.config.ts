import { defineConfig } from 'vitest/config'

// Live recordings/validation only: these make real model API calls and require
// credentials. They are excluded from the default offline test run.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/live/**/*.test.ts'],
  },
})
