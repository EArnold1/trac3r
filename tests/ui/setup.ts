// Radix measures elements with ResizeObserver, which jsdom does not have.
class ResizeObserverStub {
  observe(): void {
    /* nothing is laid out in jsdom */
  }
  unobserve(): void {
    /* nothing is laid out in jsdom */
  }
  disconnect(): void {
    /* nothing is laid out in jsdom */
  }
}

globalThis.ResizeObserver = ResizeObserverStub
