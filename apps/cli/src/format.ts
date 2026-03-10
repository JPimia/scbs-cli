import type { JsonEnvelope } from './types';

export interface RenderedResult<T> {
  data: T;
  text: string;
}

export const toJson = <T>(command: string, data: T): string =>
  JSON.stringify({ ok: true, command, data } satisfies JsonEnvelope<T>, null, 2);

export const printValue = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.map((entry) => printValue(entry)).join('\n\n');
  }

  if (value && typeof value === 'object') {
    return Object.entries(value)
      .map(([key, entry]) => `${key}: ${formatPrimitive(entry)}`)
      .join('\n');
  }

  return formatPrimitive(value);
};

const formatPrimitive = (value: unknown): string => {
  if (Array.isArray(value) || (value && typeof value === 'object')) {
    return JSON.stringify(value);
  }

  return `${value ?? ''}`;
};
