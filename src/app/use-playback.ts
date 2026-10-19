import { useEffect } from 'react'
import type { Speed } from './reducer'

/** Base time between steps; the speed setting divides it. */
const STEP_MS = 800

/** A timeout chain: each step schedules the next, so changing speed takes effect straight away. */
export function usePlayback(
  playing: boolean,
  speed: Speed,
  stepIndex: number,
  onTick: () => void,
): void {
  useEffect(() => {
    if (!playing) return
    const timer = window.setTimeout(onTick, STEP_MS / speed)
    return () => {
      window.clearTimeout(timer)
    }
  }, [playing, speed, stepIndex, onTick])
}
