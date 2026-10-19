import 'react'

// Lets a component pass a computed value to CSS as a custom property, which the styling rules allow.
declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style -- a record cannot have template-literal keys
  interface CSSProperties {
    [property: `--${string}`]: string | number | undefined
  }
}
