import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { RepositoryRef } from '../../protocol/src/index';

import { extractRepository } from './index';

describe('extractRepository', () => {
  it('discovers files, commands, and symbols deterministically', async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), 'scbs-extract-'));
    await mkdir(path.join(rootPath, 'src'), { recursive: true });
    await writeFile(
      path.join(rootPath, 'package.json'),
      JSON.stringify({ scripts: { build: 'tsc -b', test: 'bun test' } }, null, 2)
    );
    await writeFile(
      path.join(rootPath, 'src/index.ts'),
      'export function hello() { return "hi"; }\nimport { readFile } from "node:fs/promises";\n'
    );

    const repository: RepositoryRef = {
      id: 'repo_1',
      name: 'fixture',
      rootPath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = await extractRepository(repository);
    const repeated = await extractRepository(repository);

    expect(result.files.map((file) => file.path)).toEqual(['package.json', 'src/index.ts']);
    expect(result.commands.map((entry) => entry.source)).toEqual([
      'package.json#build',
      'package.json#test',
    ]);
    expect(result.symbols.map((symbol) => symbol.name)).toEqual(['hello']);
    expect(result.facts.some((fact) => fact.type === 'script_command')).toBeTrue();
    expect(result.files.map((file) => file.id)).toEqual(repeated.files.map((file) => file.id));
    expect(result.symbols.map((symbol) => symbol.id)).toEqual(
      repeated.symbols.map((symbol) => symbol.id)
    );
    expect(result.facts.map((fact) => fact.id)).toEqual(repeated.facts.map((fact) => fact.id));
  });
});
