import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/HacKU_2026_TeamJopz/' : '/',
  test: {
    environment: 'node',
  },
})
