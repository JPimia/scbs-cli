import type {
  ClaimRecord,
  DependencyEdge,
  FactRecord,
  FileRecord,
  SymbolRecord,
} from '../../../protocol/src/index';

import { rollupFreshness } from '../../../freshness/src/index';

import { deterministicId, nowIso } from '../utils';

function sortAnchors<T extends { filePath: string; startLine?: number }>(anchors: T[]): T[] {
  return [...anchors].sort(
    (left, right) =>
      left.filePath.localeCompare(right.filePath) || (left.startLine ?? 0) - (right.startLine ?? 0)
  );
}

export function deriveClaims(
  repoId: string,
  files: FileRecord[],
  symbols: SymbolRecord[],
  facts: FactRecord[],
  edges: DependencyEdge[],
  now = new Date()
): ClaimRecord[] {
  const repoFiles = files.filter((file) => file.repoId === repoId);
  const repoSymbols = symbols.filter((symbol) => symbol.repoId === repoId);
  const repoFacts = facts.filter((fact) => fact.repoId === repoId);
  const repoEdges = edges.filter((edge) => edge.repoId === repoId);

  const symbolById = new Map(repoSymbols.map((symbol) => [symbol.id, symbol]));
  const factsByFile = new Map<string, FactRecord[]>();
  const symbolFactsById = new Map<string, FactRecord[]>();
  const containsEdgesByFile = new Map<string, DependencyEdge[]>();
  const importEdgesByFile = new Map<string, DependencyEdge[]>();

  for (const fact of repoFacts) {
    const filePath = fact.anchors[0]?.filePath;
    if (filePath) {
      factsByFile.set(filePath, [...(factsByFile.get(filePath) ?? []), fact]);
    }
    if (fact.type === 'symbol_def') {
      symbolFactsById.set(fact.subjectId, [...(symbolFactsById.get(fact.subjectId) ?? []), fact]);
    }
  }

  for (const edge of repoEdges) {
    if (edge.edgeType === 'contains' && edge.fromType === 'file' && edge.toType === 'symbol') {
      containsEdgesByFile.set(edge.fromId, [...(containsEdgesByFile.get(edge.fromId) ?? []), edge]);
    }
    if (edge.edgeType === 'imports' && edge.fromType === 'file') {
      importEdgesByFile.set(edge.fromId, [...(importEdgesByFile.get(edge.fromId) ?? []), edge]);
    }
  }

  const claims: ClaimRecord[] = [];

  for (const file of [...repoFiles].sort((left, right) => left.path.localeCompare(right.path))) {
    const fileFacts = factsByFile.get(file.path) ?? [];
    const fileHashFact = fileFacts.find((fact) => fact.type === 'file_hash');
    if (fileHashFact) {
      claims.push({
        id: deterministicId('claim', repoId, 'file', file.path, fileHashFact.versionStamp),
        repoId,
        text: `${file.path} is present in the repository snapshot`,
        type: 'observed',
        confidence: 1,
        trustTier: 'source',
        factIds: [fileHashFact.id],
        anchors: fileHashFact.anchors,
        freshness: fileHashFact.freshness,
        invalidationKeys: [file.path],
        metadata: {
          filePath: file.path,
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
        id: deterministicId('claim', repoId, 'symbol', file.path, symbolName, fact.versionStamp),
        repoId,
        text: `${file.path} exports ${symbolName}`,
        type: 'observed',
        confidence: 1,
        trustTier: 'source',
        factIds: [fact.id],
        anchors: fact.anchors,
        freshness: fact.freshness,
        invalidationKeys: [file.path],
        metadata: {
          filePath: file.path,
          claimKind: 'symbol_export',
          symbolName,
          symbolKind: fact.value.kind,
          symbolIds: [fact.subjectId],
        },
        createdAt: nowIso(now),
        updatedAt: nowIso(now),
      });
    }

    const containedSymbols = (containsEdgesByFile.get(file.id) ?? [])
      .map((edge) => ({
        edge,
        symbol: symbolById.get(edge.toId),
        facts: symbolFactsById.get(edge.toId) ?? [],
      }))
      .filter(
        (
          entry
        ): entry is {
          edge: DependencyEdge;
          symbol: SymbolRecord;
          facts: FactRecord[];
        } => Boolean(entry.symbol)
      )
      .sort((left, right) => left.symbol.name.localeCompare(right.symbol.name));

    if (containedSymbols.length > 0) {
      const interfaceFacts = containedSymbols.flatMap((entry) => entry.facts);
      const anchors = sortAnchors([
        ...containedSymbols.map((entry) => entry.symbol.anchor),
        ...(fileHashFact?.anchors ?? []),
      ]);
      const freshness = rollupFreshness(
        interfaceFacts.map((fact) => fact.freshness).concat(fileHashFact?.freshness ?? [])
      ) as ClaimRecord['freshness'];
      const exportedSymbols = containedSymbols.map((entry) => entry.symbol.name);
      claims.push({
        id: deterministicId('claim', repoId, 'interface', file.path, file.versionStamp),
        repoId,
        text: `${file.path} exposes ${exportedSymbols.join(', ')}`,
        type: 'composed',
        confidence: 0.95,
        trustTier: 'derived',
        factIds: interfaceFacts.map((fact) => fact.id),
        anchors,
        freshness,
        invalidationKeys: [file.path],
        metadata: {
          filePath: file.path,
          claimKind: 'file_interface',
          symbolIds: containedSymbols.map((entry) => entry.symbol.id),
          symbolNames: exportedSymbols,
          edgeIds: containedSymbols.map((entry) => entry.edge.id),
          supportKinds: [...new Set(containedSymbols.map((entry) => entry.symbol.kind))],
        },
        createdAt: nowIso(now),
        updatedAt: nowIso(now),
      });
    }

    for (const fact of fileFacts.filter((entry) => entry.type === 'script_command')) {
      const command = String(fact.value.command ?? '');
      const scriptName = String(fact.value.scriptName ?? fact.value.source ?? 'script');
      claims.push({
        id: deterministicId('claim', repoId, 'command', file.path, scriptName, fact.versionStamp),
        repoId,
        text: `${file.path} defines ${scriptName}: ${command}`,
        type: 'observed',
        confidence: 1,
        trustTier: 'source',
        factIds: [fact.id],
        anchors: fact.anchors,
        freshness: fact.freshness,
        invalidationKeys: [file.path],
        metadata: {
          filePath: file.path,
          claimKind: 'script_command',
          command,
          scriptName,
          source: fact.value.source,
        },
        createdAt: nowIso(now),
        updatedAt: nowIso(now),
      });
    }

    for (const edge of importEdgesByFile.get(file.id) ?? []) {
      if (!fileHashFact) {
        continue;
      }
      const importPath = String(edge.metadata?.importPath ?? edge.toId);
      claims.push({
        id: deterministicId('claim', repoId, 'import', file.path, importPath, file.versionStamp),
        repoId,
        text: `${file.path} imports ${importPath}`,
        type: 'composed',
        confidence: 0.92,
        trustTier: 'derived',
        factIds: [fileHashFact.id],
        anchors: fileHashFact.anchors,
        freshness: fileHashFact.freshness,
        invalidationKeys: [file.path, importPath],
        metadata: {
          filePath: file.path,
          claimKind: 'file_import',
          importPath,
          edgeIds: [edge.id],
          relation: 'imports',
          targetId: edge.toId,
          isExternal: !importPath.startsWith('.') && !importPath.startsWith('/'),
        },
        createdAt: nowIso(now),
        updatedAt: nowIso(now),
      });
    }
  }

  return claims.sort((left, right) => left.id.localeCompare(right.id));
}
