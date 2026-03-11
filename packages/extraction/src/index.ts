import path from 'node:path';

import type {
  DependencyEdge,
  FactRecord,
  FileRecord,
  RepositoryRef,
  SymbolRecord,
} from '../../protocol/src/index';

import {
  classifyFile,
  discoverExports,
  discoverImports,
  discoverPackageCommands,
  makeAnchor,
} from './parsers';
import { scanRepositoryFiles } from './scanners';
import type { ExtractionOptions, RepositoryScanResult } from './types';
import { deterministicId, nowIso, stableHash } from './utils';

export async function extractRepository(
  repository: RepositoryRef,
  options: ExtractionOptions = {}
): Promise<RepositoryScanResult> {
  if (!repository.rootPath) {
    throw new Error(`Repository ${repository.id} is missing rootPath`);
  }

  const scanTime = options.now ?? new Date();
  const scanFiles = await scanRepositoryFiles(repository.rootPath);

  const files: FileRecord[] = [];
  const symbols: SymbolRecord[] = [];
  const facts: FactRecord[] = [];
  const edges: DependencyEdge[] = [];
  const commands = [];

  for (const scanFile of scanFiles) {
    const hash = stableHash(scanFile.content);
    const { language, kind } = classifyFile(scanFile.relativePath);
    const fileId = deterministicId('file', repository.id, scanFile.relativePath);
    const fileRecord: FileRecord = {
      id: fileId,
      repoId: repository.id,
      path: scanFile.relativePath,
      language,
      kind,
      hash,
      sizeBytes: scanFile.sizeBytes,
      exists: true,
      versionStamp: hash,
      lastSeenAt: nowIso(scanTime),
      metadata: {
        absolutePath: scanFile.absolutePath,
      },
    };
    files.push(fileRecord);

    const fileAnchor = makeAnchor(repository.id, scanFile.relativePath, hash, 1);
    facts.push({
      id: deterministicId('fact', repository.id, 'file_hash', scanFile.relativePath, hash),
      repoId: repository.id,
      type: 'file_hash',
      subjectType: 'file',
      subjectId: fileId,
      value: {
        hash,
        path: scanFile.relativePath,
        language,
        kind,
      },
      anchors: [fileAnchor],
      versionStamp: hash,
      freshness: 'fresh',
      createdAt: nowIso(scanTime),
      updatedAt: nowIso(scanTime),
    });

    for (const entry of discoverPackageCommands(scanFile.relativePath, scanFile.content)) {
      commands.push(entry);
      facts.push({
        id: deterministicId(
          'fact',
          repository.id,
          'script_command',
          scanFile.relativePath,
          entry.source,
          hash
        ),
        repoId: repository.id,
        type: 'script_command',
        subjectType: entry.kind === 'test' ? 'test' : 'script',
        subjectId: fileId,
        value: {
          path: scanFile.relativePath,
          scriptName: entry.source.split('#').at(-1),
          source: entry.source,
          command: entry.command,
        },
        anchors: [fileAnchor],
        versionStamp: hash,
        freshness: 'fresh',
        createdAt: nowIso(scanTime),
        updatedAt: nowIso(scanTime),
      });
    }

    if (kind !== 'source' && kind !== 'test') {
      continue;
    }

    for (const discoveredImport of discoverImports(scanFile.content)) {
      const importTargetId = deterministicId('file_ref', repository.id, discoveredImport);
      edges.push({
        id: deterministicId(
          'edge',
          repository.id,
          fileId,
          'imports',
          importTargetId,
          discoveredImport
        ),
        repoId: repository.id,
        fromType: 'file',
        fromId: fileId,
        toType: 'file',
        toId: importTargetId,
        edgeType: 'imports',
        metadata: { importPath: discoveredImport },
      });
    }

    for (const exportedSymbol of discoverExports(scanFile.content)) {
      const symbolId = deterministicId(
        'sym',
        repository.id,
        scanFile.relativePath,
        exportedSymbol.name,
        exportedSymbol.kind,
        exportedSymbol.line
      );
      const anchor = makeAnchor(repository.id, scanFile.relativePath, hash, exportedSymbol.line);
      const symbolRecord: SymbolRecord = {
        id: symbolId,
        repoId: repository.id,
        fileId,
        name: exportedSymbol.name,
        kind: exportedSymbol.kind,
        exportName: exportedSymbol.name,
        signature: `${exportedSymbol.kind} ${exportedSymbol.name}`,
        anchor,
        metadata: {},
      };
      symbols.push(symbolRecord);
      facts.push({
        id: deterministicId(
          'fact',
          repository.id,
          'symbol_def',
          scanFile.relativePath,
          exportedSymbol.name,
          exportedSymbol.kind,
          hash
        ),
        repoId: repository.id,
        type: 'symbol_def',
        subjectType: 'symbol',
        subjectId: symbolId,
        value: {
          filePath: scanFile.relativePath,
          name: exportedSymbol.name,
          kind: exportedSymbol.kind,
        },
        anchors: [anchor],
        versionStamp: hash,
        freshness: 'fresh',
        createdAt: nowIso(scanTime),
        updatedAt: nowIso(scanTime),
      });
      edges.push({
        id: deterministicId('edge', repository.id, fileId, 'contains', symbolId),
        repoId: repository.id,
        fromType: 'file',
        fromId: fileId,
        toType: 'symbol',
        toId: symbolId,
        edgeType: 'contains',
        metadata: {},
      });
    }
  }

  return {
    repository,
    files,
    symbols,
    facts,
    edges,
    commands: commands.sort((left, right) => left.source.localeCompare(right.source)),
  };
}

export * from './types';
