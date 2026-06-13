import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      // Main-process tests (Node environment, no DOM)
      {
        test: {
          name: 'main',
          include: ['src/main/**/*.test.ts'],
          environment: 'node',
          globals: false,
        },
      },
      // Renderer tests (jsdom environment, React components)
      {
        plugins: [react()],
        resolve: {
          alias: {
            '@renderer': path.resolve(__dirname, 'src/renderer/src'),
          },
        },
        test: {
          name: 'renderer',
          include: ['src/renderer/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          globals: false,
          setupFiles: ['src/renderer/src/__tests__/setup.ts'],
        },
      },
    ],
  },
})
