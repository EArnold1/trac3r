import { ChevronLeft, ChevronRight, Pause, Play, SkipBack } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { Speed } from './reducer'

const SPEEDS: readonly Speed[] = [0.5, 1, 2]

interface ControlsProps {
  /** 0-based. */
  stepIndex: number
  stepTotal: number
  playing: boolean
  speed: Speed
  onReset: () => void
  onPrev: () => void
  onNext: () => void
  onTogglePlay: () => void
  onSeek: (index: number) => void
  onSpeed: (speed: Speed) => void
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Step, replay, scrub and speed. The arrow keys and Space also work; see app.tsx. */
export function Controls(props: ControlsProps) {
  const { stepIndex, stepTotal, playing, speed } = props
  const empty = stepTotal === 0
  const atStart = stepIndex <= 0
  const atEnd = stepIndex >= stepTotal - 1

  // On a wide screen the page fits the window and this sits at the bottom of it. On a narrow one the
  // page scrolls, so the bar sticks to the bottom of the window instead.
  return (
    <Card className="mx-6 mt-3 mb-4 flex-none flex-row flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 max-[980px]:sticky max-[980px]:bottom-4 max-[980px]:z-10 max-[980px]:shadow-lg">
      <div className="flex items-center gap-2">
        <IconButton
          label="Back to the first step"
          disabled={empty || atStart}
          onClick={props.onReset}
        >
          <SkipBack className="size-5" />
        </IconButton>
        <IconButton label="Previous step" disabled={empty || atStart} onClick={props.onPrev}>
          <ChevronLeft className="size-5" />
        </IconButton>
        <Button type="button" variant="outline" disabled={empty} onClick={props.onTogglePlay}>
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          {playing ? 'Pause' : 'Replay'}
        </Button>
        <IconButton label="Next step" disabled={empty || atEnd} onClick={props.onNext}>
          <ChevronRight className="size-5" />
        </IconButton>
      </div>
      <Slider
        aria-label="Step"
        className="min-w-40 flex-1 basis-56"
        min={1}
        max={Math.max(stepTotal, 1)}
        step={1}
        disabled={empty}
        value={[empty ? 1 : stepIndex + 1]}
        onValueChange={([value]) => {
          if (value !== undefined) props.onSeek(value - 1)
        }}
      />
      <span className="text-dense whitespace-nowrap">
        {empty ? 'No steps' : `Step ${String(stepIndex + 1)} of ${String(stepTotal)}`}
      </span>
      <div className="flex items-center gap-2">
        <label htmlFor="speed" className="text-dense text-muted-foreground">
          Speed
        </label>
        <Select
          value={String(speed)}
          onValueChange={(value) => {
            const next = SPEEDS.find((s) => String(s) === value)
            if (next !== undefined) props.onSpeed(next)
          }}
        >
          <SelectTrigger id="speed" className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SPEEDS.map((s) => (
              <SelectItem key={s} value={String(s)}>
                {String(s)}x
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <span className="hidden text-label text-muted-foreground sm:inline">
        Left and right arrow keys also step.
      </span>
    </Card>
  )
}
