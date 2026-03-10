import path from 'node:path';

import type { SourceAnchor } from '../../protocol/src/index';

import { stableHash } from './utils';

const IMPORT_RE = /(?:import|export)\s.+?from\s+["']([^"']+)["']/g;
const EXPORT_RE =
  /export\s+(?:async\s+)?(?:function|class|const|type|interface|enum)\s+([A-Za-z0-9_]+)/g;

export function classifyFile(filePath: string): { language?: string; kind: string } {
  const ext = path.extname(filePath).toLowerCase();
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    return { language: ext.slice(1), kind: filePath.includes('test') ? 'test' : 'source' };
  }
  if (['.json', '.yaml', '.yml', '.toml'].includes(ext)) {
    return { language: ext.slice(1), kind: 'config' };
  }
  if (['.md', '.mdx', '.txt'].includes(ext)) {
    return { language: ext.slice(1), kind: 'doc' };
  }
  return { language: ext ? ext.slice(1) : undefined, kind: 'source' };
}

export function discoverImports(content: string): string[] {
  const imports = new Set<string>();
  for (const match of content.matchAll(IMPORT_RE)) {
    if (match[1]) {
      imports.add(match[1]);
    }
  }
  return [...imports].sort();
}

export function discoverExports(
  content: string
): Array<{ name: string; kind: string; line: number }> {
  const exports: Array<{ name: string; kind: string; line: number }> = [];
  for (const match of content.matchAll(EXPORT_RE)) {
    const full = match[0] ?? '';
    const name = match[1];
    if (!name) {
      continue;
    }
    const index = match.index ?? 0;
    const line = content.slice(0, index).split('\n').length;
    let kind = 'symbol';
    if (full.includes('function')) kind = 'function';
    else if (full.includes('class')) kind = 'class';
    else if (full.includes('interface')) kind = 'interface';
    else if (full.includes('type')) kind = 'type';
    else if (full.includes('const')) kind = 'const';
    else if (full.includes('enum')) kind = 'enum';
    exports.push({ name, kind, line });
  }
  return exports;
}

export function makeAnchor(
  repoId: string,
  filePath: string,
  fileHash: string,
  startLine?: number
): SourceAnchor {
  return {
    repoId,
    filePath,
    fileHash,
    startLine,
    excerptHash: stableHash(`${filePath}:${startLine ?? 0}:${fileHash}`),
  };
}

export function discoverPackageCommands(
  relativePath: string,
  content: string
): Array<{ command: string; source: string; kind: 'script' | 'test' }> {
  if (!relativePath.endsWith('package.json')) {
    return [];
  }
  const parsed = JSON.parse(content) as { scripts?: Record<string, string> };
  const scripts = parsed.scripts ?? {};
  return Object.entries(scripts).map(([name, command]) => ({
    command,
    source: `package.json#${name}`,
    kind: /test/i.test(name) ? 'test' : 'script',
  }));
}
