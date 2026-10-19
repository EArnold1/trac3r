/** Narration marks code with backticks; this shows those parts in the code font. */
export function Narration({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className="font-mono text-[0.9em] break-words">
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  )
}
