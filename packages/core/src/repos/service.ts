import { extractRepository } from '../../../extraction/src/index';
import type { FileRecord, RepositoryRef } from '../../../protocol/src/index';

import type { CoreStore } from '../storage/memory-store';
import { createId, nowIso } from '../utils';

export interface RegisterRepositoryInput {
  name: string;
  rootPath: string;
  remoteUrl?: string;
  defaultBranch?: string;
  provider?: string;
  projectKey?: string;
  metadata?: Record<string, unknown>;
}

export class RepositoryService {
  constructor(private readonly store: CoreStore) {}

  register(input: RegisterRepositoryInput, now = new Date()): RepositoryRef {
    const repository: RepositoryRef = {
      id: createId('repo'),
      name: input.name,
      rootPath: input.rootPath,
      remoteUrl: input.remoteUrl,
      defaultBranch: input.defaultBranch,
      provider: input.provider ?? 'git',
      projectKey: input.projectKey,
      metadata: input.metadata ?? {},
      createdAt: nowIso(now),
      updatedAt: nowIso(now),
    };
    this.store.repositories.push(repository);
    return repository;
  }

  list(): RepositoryRef[] {
    return [...this.store.repositories];
  }

  get(id: string): RepositoryRef | undefined {
    return this.store.repositories.find((repository) => repository.id === id);
  }

  async scan(id: string): Promise<{
    repository: RepositoryRef;
    files: FileRecord[];
    commands: string[];
  }> {
    const repository = this.get(id);
    if (!repository) {
      throw new Error(`Repository ${id} not found`);
    }

    const result = await extractRepository(repository);
    this.store.files = this.store.files.filter((file) => file.repoId !== id).concat(result.files);
    this.store.facts = this.store.facts.filter((fact) => fact.repoId !== id).concat(result.facts);
    this.store.edges = this.store.edges.filter((edge) => edge.repoId !== id).concat(result.edges);

    return {
      repository,
      files: result.files,
      commands: result.commands.map((command) => command.command),
    };
  }
}
