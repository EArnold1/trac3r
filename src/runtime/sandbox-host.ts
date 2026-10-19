// Creates the sandboxed iframe, starts the run and enforces the timeout.
// Browser only. Every run gets a new iframe and a new Worker; nothing is reused.
import { TIMEOUT_MS } from '../engine/limits'
import type { RunResult } from '../engine/types'
import { sandboxDocument } from './bootstrap'
import { isSandboxMessage, isWorkerPartial, isWorkerResult, workerMessageKind } from './messages'
import type { StartMessage, WorkerResult } from './messages'

/** The iframe never reports ready: its document failed to load or its script was blocked. */
const STARTUP_TIMEOUT_MS = 5000

export class SandboxStartError extends Error {
  override name = 'SandboxStartError'
}

export function runInSandbox(
  source: string,
  workerSource: string,
  signal?: AbortSignal,
): Promise<RunResult> {
  return new Promise<RunResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Run superseded', 'AbortError'))
      return
    }

    const startedAt = performance.now()
    const iframe = document.createElement('iframe')
    iframe.setAttribute('sandbox', 'allow-scripts')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.tabIndex = -1
    iframe.hidden = true
    iframe.srcdoc = sandboxDocument()

    let runTimer: ReturnType<typeof setTimeout> | undefined
    let settled = false
    /**
     * The latest progress report from the Worker, for when the run never finishes. It is only
     * checked if it is needed, because a long trace is slow to validate.
     */
    let latestPartial: unknown

    const startupTimer = setTimeout(() => {
      finish(() => {
        reject(new SandboxStartError('The sandbox did not start'))
      })
    }, STARTUP_TIMEOUT_MS)

    function finish(settle: () => void): void {
      if (settled) return
      settled = true
      clearTimeout(startupTimer)
      clearTimeout(runTimer)
      window.removeEventListener('message', onMessage)
      signal?.removeEventListener('abort', onAbort)
      // Removing the iframe kills the Worker and everything in it.
      iframe.remove()
      settle()
    }

    function complete(worker: WorkerResult): void {
      finish(() => {
        resolve({
          status: worker.status,
          ...(worker.result !== undefined && { result: worker.result }),
          ...(worker.error !== undefined && { error: worker.error }),
          output: worker.output,
          steps: worker.steps,
          notTraced: worker.notTraced,
          truncated: worker.truncated,
          durationMs: performance.now() - startedAt,
        })
      })
    }

    function onTimeout(): void {
      const partial = isWorkerPartial(latestPartial) ? latestPartial : undefined
      finish(() => {
        resolve({
          status: 'timeout',
          output: partial?.output ?? [],
          steps: partial?.steps ?? [],
          notTraced: partial?.notTraced ?? [],
          truncated: partial?.truncated ?? false,
          durationMs: performance.now() - startedAt,
        })
      })
    }

    function onAbort(): void {
      finish(() => {
        reject(new DOMException('Run superseded', 'AbortError'))
      })
    }

    function onMessage(event: MessageEvent<unknown>): void {
      // Only the sandbox iframe may talk to us, and only in messages we can validate.
      if (event.source !== iframe.contentWindow) return
      if (!isSandboxMessage(event.data)) return
      const message = event.data
      switch (message.type) {
        case 'ready': {
          clearTimeout(startupTimer)
          const start: StartMessage = { type: 'start', workerSource, code: source }
          // The iframe has an opaque origin, so "*" is the only possible target origin.
          iframe.contentWindow?.postMessage(start, '*')
          runTimer = setTimeout(onTimeout, TIMEOUT_MS)
          return
        }
        case 'worker-message':
          if (workerMessageKind(message.data) === 'partial') {
            latestPartial = message.data
          } else if (isWorkerResult(message.data)) {
            complete(message.data)
          } else {
            finish(() => {
              reject(new SandboxStartError('The sandbox sent a result that could not be read'))
            })
          }
          return
        case 'worker-error':
          complete({
            type: 'result',
            status: 'error',
            error: { name: 'Error', message: message.message, line: null },
            output: [],
            steps: [],
            notTraced: [],
            truncated: false,
          })
          return
      }
    }

    window.addEventListener('message', onMessage)
    signal?.addEventListener('abort', onAbort)
    document.body.appendChild(iframe)
  })
}
