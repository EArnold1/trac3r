// Test-only page: exposes run() so Playwright can drive the sandbox without the UI.
import { run } from '../../src/runtime/index'

declare global {
  interface Window {
    tracerRun: typeof run
    __pending: ReturnType<typeof run>
  }
}

window.tracerRun = run
