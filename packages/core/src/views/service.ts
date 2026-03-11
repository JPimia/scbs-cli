import type {
  ClaimRecord,
  DependencyEdge,
  FileRecord,
  SymbolRecord,
  ViewRecord,
} from '../../../protocol/src/index';

import { rollupFreshness } from '../../../freshness/src/index';

import { deterministicId, nowIso } from '../utils';

function uniqueSorted(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function filePathFromClaim(claim: ClaimRecord): string | undefined {
  return typeof claim.metadata?.filePath === 'string' ? claim.metadata.filePath : undefined;
}

export function deriveViews(
  repoId: string,
  filesOrClaims: FileRecord[] | ClaimRecord[],
  symbolsOrNow?: SymbolRecord[] | Date,
  claimsOrNow?: ClaimRecord[] | Date,
  edgesOrNow?: DependencyEdge[] | Date,
  now = new Date()
): ViewRecord[] {
  const firstEntry = Array.isArray(filesOrClaims) ? filesOrClaims[0] : undefined;
  const files =
    Array.isArray(filesOrClaims) &&
    (filesOrClaims.length === 0 || (firstEntry !== undefined && 'path' in firstEntry))
      ? (filesOrClaims as FileRecord[])
      : [];
  const symbols = Array.isArray(symbolsOrNow) ? (symbolsOrNow as SymbolRecord[]) : [];
  const claims =
    Array.isArray(filesOrClaims) &&
    (filesOrClaims.length === 0 || (firstEntry !== undefined && 'text' in firstEntry))
      ? (filesOrClaims as ClaimRecord[])
      : Array.isArray(claimsOrNow)
        ? (claimsOrNow as ClaimRecord[])
        : [];
  const edges = Array.isArray(edgesOrNow) ? (edgesOrNow as DependencyEdge[]) : [];
  const viewTime =
    now instanceof Date
      ? now
      : symbolsOrNow instanceof Date
        ? symbolsOrNow
        : claimsOrNow instanceof Date
          ? claimsOrNow
          : edgesOrNow instanceof Date
            ? edgesOrNow
            : new Date();

  const repoFiles = files.filter((file) => file.repoId === repoId);
  const repoSymbols = symbols.filter((symbol) => symbol.repoId === repoId);
  const repoClaims = claims.filter((claim) => claim.repoId === repoId);
  const repoEdges = edges.filter((edge) => edge.repoId === repoId);

  const fileGroups = new Map<string, ClaimRecord[]>();
  const workflowGroups = new Map<string, ClaimRecord[]>();
  const interfaceClaims = repoClaims.filter(
    (claim) => claim.metadata?.claimKind === 'file_interface'
  );
  const decisionClaims = repoClaims.filter(
    (claim) => claim.metadata?.claimKind === 'file_import' && claim.metadata?.isExternal === true
  );

  for (const claim of repoClaims) {
    const filePath = filePathFromClaim(claim);
    if (filePath) {
      fileGroups.set(filePath, [...(fileGroups.get(filePath) ?? []), claim]);
    }
    if (claim.metadata?.claimKind === 'script_command') {
      const workflowKey = String(claim.metadata.source ?? filePath ?? claim.id);
      workflowGroups.set(workflowKey, [...(workflowGroups.get(workflowKey) ?? []), claim]);
    }
  }

  const directoryGroups = new Map<string, FileRecord[]>();
  for (const file of repoFiles) {
    const directory = file.path.includes('/')
      ? file.path.slice(0, file.path.lastIndexOf('/'))
      : '.';
    directoryGroups.set(directory, [...(directoryGroups.get(directory) ?? []), file]);
  }

  const symbolScopeByFile = new Map<string, string[]>();
  for (const symbol of repoSymbols) {
    const filePath = repoFiles.find((file) => file.id === symbol.fileId)?.path;
    if (filePath) {
      symbolScopeByFile.set(
        filePath,
        uniqueSorted([...(symbolScopeByFile.get(filePath) ?? []), symbol.name])
      );
    }
  }

  const views: ViewRecord[] = [];

  for (const [filePath, fileClaims] of [...fileGroups.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const exportedSymbols = uniqueSorted(
      fileClaims.flatMap((claim) =>
        Array.isArray(claim.metadata?.symbolNames)
          ? claim.metadata.symbolNames.map(String)
          : typeof claim.metadata?.symbolName === 'string'
            ? [claim.metadata.symbolName]
            : []
      )
    );
    const commands = uniqueSorted(
      fileClaims
        .filter((claim) => claim.metadata?.claimKind === 'script_command')
        .map((claim) => String(claim.metadata?.scriptName))
    );
    const imports = uniqueSorted(
      fileClaims
        .filter((claim) => claim.metadata?.claimKind === 'file_import')
        .map((claim) => String(claim.metadata?.importPath))
    );
    const summaryParts = [`${filePath} contributes ${fileClaims.length} anchored claim(s)`];
    if (exportedSymbols.length > 0) {
      summaryParts.push(`exports ${exportedSymbols.join(', ')}`);
    }
    if (commands.length > 0) {
      summaryParts.push(`defines commands ${commands.join(', ')}`);
    }
    if (imports.length > 0) {
      summaryParts.push(`imports ${imports.join(', ')}`);
    }
    views.push({
      id: deterministicId('view', repoId, 'file_scope', filePath),
      repoId,
      type: 'file_scope',
      key: filePath,
      title: filePath,
      summary: summaryParts.join(' and '),
      claimIds: fileClaims.map((claim) => claim.id),
      fileScope: [filePath],
      symbolScope: exportedSymbols,
      freshness: rollupFreshness(
        fileClaims.map((claim) => claim.freshness)
      ) as ViewRecord['freshness'],
      metadata: {
        trustTier: fileClaims.some((claim) => claim.trustTier === 'source') ? 'source' : 'derived',
        anchorCount: fileClaims.flatMap((claim) => claim.anchors).length,
        rationale:
          'Anchored file view derived from file facts, exported symbols, and import edges.',
      },
      createdAt: nowIso(viewTime),
      updatedAt: nowIso(viewTime),
    });
  }

  for (const [workflowKey, workflowClaims] of [...workflowGroups.entries()].sort(
    ([left], [right]) => left.localeCompare(right)
  )) {
    const commandNames = uniqueSorted(
      workflowClaims.map((claim) => String(claim.metadata?.scriptName ?? claim.metadata?.source))
    );
    const fileScope = uniqueSorted(workflowClaims.map(filePathFromClaim));
    const freshness = rollupFreshness(
      workflowClaims.map((claim) => claim.freshness)
    ) as ViewRecord['freshness'];

    views.push({
      id: deterministicId('view', repoId, 'command_workflow', workflowKey),
      repoId,
      type: 'command_workflow',
      key: workflowKey,
      title: `Workflow ${workflowKey}`,
      summary: `${workflowKey} exposes commands ${commandNames.join(', ')}`,
      claimIds: workflowClaims.map((claim) => claim.id),
      fileScope,
      symbolScope: undefined,
      freshness,
      metadata: {
        trustTier: 'source',
        rationale: 'Legacy command workflow rollup from anchored script_command claims.',
      },
      createdAt: nowIso(viewTime),
      updatedAt: nowIso(viewTime),
    });

    views.push({
      id: deterministicId('view', repoId, 'workflow', workflowKey),
      repoId,
      type: 'workflow',
      key: workflowKey,
      title: `Workflow ${workflowKey}`,
      summary: `${workflowKey} exists because ${commandNames.join(', ')} are defined in ${fileScope.join(', ')}`,
      claimIds: workflowClaims.map((claim) => claim.id),
      fileScope,
      symbolScope: undefined,
      freshness,
      metadata: {
        trustTier: 'source',
        rationale: 'Derived directly from script command claims with anchored package metadata.',
        commandCount: commandNames.length,
      },
      createdAt: nowIso(viewTime),
      updatedAt: nowIso(viewTime),
    });
  }

  for (const claim of interfaceClaims.sort((left, right) => left.id.localeCompare(right.id))) {
    const filePath = filePathFromClaim(claim);
    if (!filePath) {
      continue;
    }
    const symbolScope = uniqueSorted(
      Array.isArray(claim.metadata?.symbolNames) ? claim.metadata.symbolNames.map(String) : []
    );
    views.push({
      id: deterministicId('view', repoId, 'interface', filePath),
      repoId,
      type: 'interface',
      key: filePath,
      title: `Interface ${filePath}`,
      summary: `${filePath} exposes ${symbolScope.join(', ')} because contains edges connect exported symbols to the file.`,
      claimIds: [claim.id],
      fileScope: [filePath],
      symbolScope,
      freshness: claim.freshness,
      metadata: {
        trustTier: claim.trustTier,
        rationale: 'Built from symbol_def facts plus file->symbol contains edges.',
        edgeIds: claim.metadata?.edgeIds,
      },
      createdAt: nowIso(viewTime),
      updatedAt: nowIso(viewTime),
    });
  }

  for (const [directory, directoryFiles] of [...directoryGroups.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const directoryPaths = directoryFiles.map((file) => file.path);
    const directoryClaims = repoClaims.filter((claim) => {
      const filePath = filePathFromClaim(claim);
      return filePath !== undefined && directoryPaths.includes(filePath);
    });
    if (directoryClaims.length === 0) {
      continue;
    }
    const importCount = repoEdges.filter(
      (edge) =>
        edge.edgeType === 'imports' &&
        edge.fromType === 'file' &&
        directoryFiles.some((file) => file.id === edge.fromId)
    ).length;
    const symbolScope = uniqueSorted(
      directoryFiles.flatMap((file) => symbolScopeByFile.get(file.path) ?? [])
    );
    views.push({
      id: deterministicId('view', repoId, 'subsystem', directory),
      repoId,
      type: 'subsystem',
      key: directory,
      title: directory === '.' ? 'Repository root subsystem' : `Subsystem ${directory}`,
      summary: `${directory} forms a subsystem because ${directoryFiles.length} file(s), ${symbolScope.length} symbol(s), and ${importCount} import edge(s) cluster under that path.`,
      claimIds: directoryClaims.map((claim) => claim.id),
      fileScope: directoryPaths.sort(),
      symbolScope,
      freshness: rollupFreshness(
        directoryClaims.map((claim) => claim.freshness)
      ) as ViewRecord['freshness'],
      metadata: {
        trustTier: directoryClaims.some((claim) => claim.trustTier === 'source')
          ? 'source'
          : 'derived',
        rationale: 'Grouped by anchored file paths and summarized with import-edge density.',
        importEdgeCount: importCount,
      },
      createdAt: nowIso(viewTime),
      updatedAt: nowIso(viewTime),
    });
  }

  const decisionGroups = new Map<string, ClaimRecord[]>();
  for (const claim of decisionClaims) {
    const importPath = String(claim.metadata?.importPath ?? '');
    decisionGroups.set(importPath, [...(decisionGroups.get(importPath) ?? []), claim]);
  }

  for (const [importPath, importClaims] of [...decisionGroups.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const fileScope = uniqueSorted(importClaims.map(filePathFromClaim));
    views.push({
      id: deterministicId('view', repoId, 'decision', importPath),
      repoId,
      type: 'decision',
      key: importPath,
      title: `Dependency decision ${importPath}`,
      summary: `${importPath} appears as an explicit dependency choice because ${fileScope.join(', ')} imports it.`,
      claimIds: importClaims.map((claim) => claim.id),
      fileScope,
      symbolScope: undefined,
      freshness: rollupFreshness(
        importClaims.map((claim) => claim.freshness)
      ) as ViewRecord['freshness'],
      metadata: {
        trustTier: 'derived',
        rationale: 'Narrow decision view emitted only for anchored external import claims.',
        importPath,
      },
      createdAt: nowIso(viewTime),
      updatedAt: nowIso(viewTime),
    });
  }

  return views.sort((left, right) => left.id.localeCompare(right.id));
}
