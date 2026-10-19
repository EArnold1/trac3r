import { useId } from 'react'
import type { ReactNode } from 'react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface PanelProps {
  title: string
  /** Small text on the right of the header. */
  caption?: ReactNode
  className?: string
  /** For a header that holds buttons and so needs less padding. */
  headerClassName?: string
  children: ReactNode
}

/** A card with the header row every panel shares. */
export function Panel({ title, caption, className, headerClassName, children }: PanelProps) {
  const headingId = useId()
  return (
    <Card role="region" aria-labelledby={headingId} className={cn('gap-0 py-0', className)}>
      <div
        className={cn(
          'flex flex-none items-center justify-between gap-x-3 gap-y-1.5 border-b border-border px-4 py-2.5',
          headerClassName,
        )}
      >
        <h2
          id={headingId}
          className="text-label font-semibold tracking-wide text-muted-foreground uppercase"
        >
          {title}
        </h2>
        {caption !== undefined && (
          <span className="text-label text-muted-foreground">{caption}</span>
        )}
      </div>
      {children}
    </Card>
  )
}
