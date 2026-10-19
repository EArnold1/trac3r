export interface Example {
  readonly id: string
  readonly label: string
  readonly source: string
}

export const EXAMPLES: readonly Example[] = [
  {
    id: 'factorial',
    label: 'factorial(3)',
    source: `function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}
factorial(3);`,
  },
  {
    id: 'fibonacci',
    label: 'fibonacci(4)',
    source: `function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}
fibonacci(4);`,
  },
  {
    id: 'sum-loop',
    label: 'Sum loop',
    source: `let sum = 0;
for (let i = 1; i <= 5; i++) {
  sum += i;
}
sum;`,
  },
]

export const DEFAULT_EXAMPLE: Example = EXAMPLES[0] ?? {
  id: 'empty',
  label: 'Empty',
  source: '',
}
