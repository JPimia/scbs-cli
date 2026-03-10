declare module 'bun:test' {
  export const describe: (name: string, fn: () => void | Promise<void>) => void;
  export const it: (name: string, fn: () => void | Promise<void>) => void;
  export const expect: (value: unknown) => {
    toBe: (expected: unknown) => void;
    toBeTruthy: () => void;
    toBeTrue: () => void;
    toContain: (expected: unknown) => void;
    toEqual: (expected: unknown) => void;
    toBeGreaterThan: (expected: number) => void;
    toMatchObject: (expected: Record<string, unknown>) => void;
    toThrow: (expected?: unknown) => void;
  };
}
