import type { ClaimRecord, FactRecord } from '../../../protocol/src/index';

import { deterministicId, nowIso } from '../utils';

export function deriveClaims(repoId: string, facts: FactRecord[], now = new Date()): ClaimRecord[] {
  const repoFacts = facts.filter((fact) => fact.repoId === repoId);
  const groupedByFile = new Map<string, FactRecord[]>();
  for (const fact of repoFacts) {
    const filePath = fact.anchors[0]?.filePath;
    if (!filePath) {
      continue;
    }
    groupedByFile.set(filePath, [...(groupedByFile.get(filePath) ?? []), fact]);
  }

  const claims: ClaimRecord[] = [];

  for (const [filePath, fileFacts] of [...groupedByFile.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const fileHashFact = fileFacts.find((fact) => fact.type === 'file_hash');
    if (fileHashFact) {
      claims.push({
        id: deterministicId('claim', repoId, 'file', filePath, fileHashFact.versionStamp),
        repoId,
        text: `${filePath} is present in the repository snapshot`,
        type: 'observed',
        confidence: 1,
        trustTier: 'source',
        factIds: [fileHashFact.id],
        anchors: fileHashFact.anchors,
        freshness: fileHashFact.freshness,
        invalidationKeys: [filePath],
        metadata: {
          filePath,
          claimKind: 'file_presence',
          versionStamp: fileHashFact.versionStamp,
        },
        createdAt: nowIso(now),
        updatedAt: nowIso(now),
      });
    }

    for (const fact of fileFacts.filter((entry) => entry.type === 'symbol_def')) {
      const symbolName = String(fact.value.name ?? 'unknown');
      claims.push({
        id: deterministicId('claim', repoId, 'symbol', filePath, symbolName, fact.versionStamp),
        repoId,
        text: `${filePath} exports ${symbolName}`,
        type: 'observed',
        confidence: 1,
        trustTier: 'source',
        factIds: [fact.id],
        anchors: fact.anchors,
        freshness: fact.freshness,
        invalidationKeys: [filePath],
        metadata: {
          filePath,
          claimKind: 'symbol_export',
          symbolName,
          symbolKind: fact.value.kind,
        },
        createdAt: nowIso(now),
        updatedAt: nowIso(now),
      });
    }

    for (const fact of fileFacts.filter((entry) => entry.type === 'script_command')) {
      const command = String(fact.value.command ?? '');
      const scriptName = String(fact.value.scriptName ?? fact.value.source ?? 'script');
      claims.push({
        id: deterministicId('claim', repoId, 'command', filePath, scriptName, fact.versionStamp),
        repoId,
        text: `${filePath} defines ${scriptName}: ${command}`,
        type: 'observed',
        confidence: 1,
        trustTier: 'source',
        factIds: [fact.id],
        anchors: fact.anchors,
        freshness: fact.freshness,
        invalidationKeys: [filePath],
        metadata: {
          filePath,
          claimKind: 'script_command',
          command,
          scriptName,
          source: fact.value.source,
        },
        createdAt: nowIso(now),
        updatedAt: nowIso(now),
      });
    }
  }

  return claims;
}
