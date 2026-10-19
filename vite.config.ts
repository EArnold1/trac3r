import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { workerSource } from './scripts/worker-source.ts'

export default defineConfig({
  plugins: [react(), tailwindcss(), workerSource()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  test: {
    include: [
      'tests/engine/**/*.test.ts',
      'tests/runtime/**/*.test.ts',
      'tests/ui/**/*.test.{ts,tsx}',
    ],
  },
})
