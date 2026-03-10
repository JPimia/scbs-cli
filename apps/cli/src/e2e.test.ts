import { describe, expect, it } from 'vitest';
import { runCli } from './cli';
import { InMemoryScbsService } from './in-memory-service';

describe('CLI happy path', () => {
  it('registers a repo and plans a bundle through the service adapter', async () => {
    const service = new InMemoryScbsService();

    const register = await runCli(
      ['repo', 'register', '--name', 'demo-repo', '--path', '/tmp/demo-repo', '--json'],
      service
    );
    expect(register.exitCode).toBe(0);
    expect(JSON.parse(register.stdout)).toMatchObject({
      data: {
        id: 'repo_demo-repo',
        name: 'demo-repo',
      },
    });

    const bundle = await runCli(
      ['bundle', 'plan', '--task', 'bootstrap context', '--repo', 'repo_demo-repo', '--json'],
      service
    );
    expect(bundle.exitCode).toBe(0);
    expect(JSON.parse(bundle.stdout)).toMatchObject({
      data: {
        id: 'bundle_bootstrap-context',
        repoIds: ['repo_demo-repo'],
        task: 'bootstrap context',
      },
    });
  });
});
