import { createHash, randomUUID } from 'node:crypto';

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

export function nowIso(now = new Date()): string {
  return now.toISOString();
}

export function stableHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
