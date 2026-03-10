import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_IGNORES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.overstory',
]);

export interface ScanFile {
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
  content: string;
}

export async function scanRepositoryFiles(rootPath: string): Promise<ScanFile[]> {
  const results: ScanFile[] = [];

  async function walk(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      const relativePath = path.relative(rootPath, absolutePath).replaceAll(path.sep, '/');
      if (entry.isDirectory()) {
        if (DEFAULT_IGNORES.has(entry.name)) {
          continue;
        }
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const fileStat = await stat(absolutePath);
      const content = await readFile(absolutePath, 'utf8');
      results.push({
        absolutePath,
        relativePath,
        sizeBytes: fileStat.size,
        content,
      });
    }
  }

  await walk(rootPath);
  results.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return results;
}
