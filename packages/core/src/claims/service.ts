import type { ClaimRecord, FactRecord } from '../../../protocol/src/index';

import { createId, nowIso } from '../utils';

export function deriveClaims(repoId: string, facts: FactRecord[], now = new Date()): ClaimRecord[] {
  const groupedByFile = new Map<string, FactRecord[]>();
  for (const fact of facts) {
    const filePath = fact.anchors[0]?.filePath;
    if (!filePath) {
      continue;
    }
    groupedByFile.set(filePath, [...(groupedByFile.get(filePath) ?? []), fact]);
  }

  return [...groupedByFile.entries()].map(([filePath, fileFacts]) => {
    const symbolFacts = fileFacts.filter((fact) => fact.type === 'symbol_def');
    const commands = fileFacts
      .filter((fact) => fact.type === 'script_command')
      .map((fact) => String(fact.value.command))
      .filter(Boolean);
    const summaryParts = [`${filePath} is part of the repository model`];
    if (symbolFacts.length > 0) {
      summaryParts.push(`exports ${symbolFacts.map((fact) => String(fact.value.name)).join(', ')}`);
    }
    if (commands.length > 0) {
      summaryParts.push(`declares commands ${commands.join(', ')}`);
    }
    return {
      id: createId('claim'),
      repoId,
      text: summaryParts.join(' and '),
      type: 'observed',
      confidence: 1,
      trustTier: 'source',
      factIds: fileFacts.map((fact) => fact.id),
      anchors: fileFacts.flatMap((fact) => fact.anchors),
      freshness: 'fresh',
      invalidationKeys: [filePath],
      metadata: {
        filePath,
      },
      createdAt: nowIso(now),
      updatedAt: nowIso(now),
    } satisfies ClaimRecord;
  });
}
