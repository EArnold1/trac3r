import path from 'node:path'
import { build } from 'vite'
import type { Plugin } from 'vite'

const VIRTUAL_ID = 'virtual:worker-source'
const RESOLVED_ID = `\0${VIRTUAL_ID}`

/**
 * Bundles src/runtime/worker.ts into one self-contained script and exposes it as text.
 * A sandboxed iframe has an opaque origin and cannot load a script from the app, so the
 * Worker has to reach it as a string.
 */
export function workerSource(): Plugin {
  const entry = path.resolve(import.meta.dirname, '../src/runtime/worker.ts')
  let minify = false
  return {
    name: 'worker-source',
    configResolved(config) {
      // Readable in the dev server, small in the build.
      minify = config.command === 'build'
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined
    },
    async load(id) {
      if (id !== RESOLVED_ID) return undefined
      this.addWatchFile(entry)
      const result = await build({
        configFile: false,
        logLevel: 'silent',
        build: {
          write: false,
          minify,
          target: 'es2022',
          lib: { entry, formats: ['iife'], name: 'tracerWorker' },
        },
      })
      const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) =>
        'output' in r ? r.output : [],
      )
      const chunk = outputs.find((o) => o.type === 'chunk')
      if (chunk?.type !== 'chunk') throw new Error('Worker bundle produced no chunk')
      return `export default ${JSON.stringify(chunk.code)}`
    },
  }
}
