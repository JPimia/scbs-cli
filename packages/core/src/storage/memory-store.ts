import type {
  AgentReceipt,
  BundleCacheEntry,
  ClaimRecord,
  DependencyEdge,
  FactRecord,
  FileRecord,
  RepositoryRef,
  TaskBundle,
  ViewRecord,
} from '../../../protocol/src/index';

export interface CoreStore {
  repositories: RepositoryRef[];
  files: FileRecord[];
  facts: FactRecord[];
  claims: ClaimRecord[];
  views: ViewRecord[];
  bundles: TaskBundle[];
  bundleCache: BundleCacheEntry[];
  receipts: AgentReceipt[];
  edges: DependencyEdge[];
}

export function createMemoryStore(initial?: Partial<CoreStore>): CoreStore {
  return {
    repositories: [...(initial?.repositories ?? [])],
    files: [...(initial?.files ?? [])],
    facts: [...(initial?.facts ?? [])],
    claims: [...(initial?.claims ?? [])],
    views: [...(initial?.views ?? [])],
    bundles: [...(initial?.bundles ?? [])],
    bundleCache: [...(initial?.bundleCache ?? [])],
    receipts: [...(initial?.receipts ?? [])],
    edges: [...(initial?.edges ?? [])],
  };
}
