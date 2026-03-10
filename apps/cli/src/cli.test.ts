import { describe, expect, it } from 'vitest';
import { runCli } from './cli';
import { InMemoryScbsService } from './in-memory-service';

describe('CLI parsing', () => {
  it('returns JSON for commands with --json', async () => {
    const result = await runCli(['health', '--json'], new InMemoryScbsService());

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: 'health',
      data: {
        status: 'ok',
      },
    });
  });

  it('requires mandatory options for repo register', async () => {
    const result = await runCli(['repo', 'register', '--name', 'demo'], new InMemoryScbsService());

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('--path');
  });

  it('parses csv options for repo changes', async () => {
    const service = new InMemoryScbsService();
    const result = await runCli(
      ['repo', 'changes', 'repo_local-default', '--files', 'src/a.ts,src/b.ts', '--json'],
      service
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      data: {
        repoId: 'repo_local-default',
        impacts: 2,
      },
    });
  });
});
