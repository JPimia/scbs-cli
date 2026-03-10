import type {
  DependencyEdge,
  FactRecord,
  FileRecord,
  RepositoryRef,
  SymbolRecord,
} from '../../protocol/src/index';

export interface ExtractionOptions {
  includeGlobs?: string[];
  excludeGlobs?: string[];
  now?: Date;
}

export interface CommandDiscovery {
  command: string;
  source: string;
  kind: 'script' | 'test' | 'ci';
}

export interface RepositoryScanResult {
  repository: RepositoryRef;
  files: FileRecord[];
  symbols: SymbolRecord[];
  facts: FactRecord[];
  edges: DependencyEdge[];
  commands: CommandDiscovery[];
}
