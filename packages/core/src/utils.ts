import { createHash, randomUUID } from 'node:crypto';

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

export function deterministicId(
  prefix: string,
  ...parts: Array<string | number | undefined>
): string {
  const seed = parts
    .filter((part): part is string | number => part !== undefined)
    .map((part) => String(part))
    .join('\u001f');
  return `${prefix}_${stableHash(seed).slice(0, 24)}`;
}

export function nowIso(now = new Date()): string {
  return now.toISOString();
}

export function stableHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
