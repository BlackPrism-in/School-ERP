import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    // Only the frontend suite. The API has its own config under api/.
    include: ['src/**/*.test.ts'],
    exclude: ['api/**', 'dist/**', 'node_modules/**'],
    environment: 'happy-dom',
    globals: false,
  },
})
