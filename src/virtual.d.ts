declare module 'virtual:worker-source' {
  /** The bundled Worker script as text, ready to be started from a blob URL. */
  const source: string
  // eslint-disable-next-line no-restricted-syntax -- a Vite virtual module can only expose a default export
  export default source
}
