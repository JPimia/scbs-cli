import { printValue, toJson } from './format';
import type {
  BundlePlanInput,
  ReceiptSubmitInput,
  RegisterRepoInput,
  RepoChangesInput,
  ScbsService,
} from './service';

interface OptionDefinition {
  name: string;
  type: 'string' | 'csv';
  required?: boolean;
}

interface CommandDefinition {
  path: string[];
  positionals?: string[];
  options?: OptionDefinition[];
  description: string;
  run: (context: CommandContext) => Promise<unknown>;
}

type ParsedInput =
  | {
      kind: 'help';
      json: boolean;
    }
  | {
      kind: 'command';
      json: boolean;
      definition: CommandDefinition;
      commandName: string;
      values: Record<string, string | string[]>;
    };

interface CommandContext {
  values: Record<string, string | string[]>;
  service: ScbsService;
}

const commandDefinitions: CommandDefinition[] = [
  {
    path: ['init'],
    description: 'Initialize local SCBS config',
    run: ({ service }) => service.init('config/scbs.config.yaml'),
  },
  {
    path: ['serve'],
    description: 'Start the SCBS service',
    run: ({ service }) => service.serve(),
  },
  {
    path: ['health'],
    description: 'Check service health',
    run: ({ service }) => service.health(),
  },
  {
    path: ['doctor'],
    description: 'Run local diagnostics',
    run: ({ service }) => service.doctor(),
  },
  {
    path: ['migrate'],
    description: 'Run migrations',
    run: ({ service }) => service.migrate(),
  },
  {
    path: ['repo', 'register'],
    description: 'Register a repository',
    options: [
      { name: 'name', type: 'string', required: true },
      { name: 'path', type: 'string', required: true },
    ],
    run: ({ service, values }) =>
      service.registerRepo({
        name: getRequiredString(values, 'name'),
        path: getRequiredString(values, 'path'),
      } satisfies RegisterRepoInput),
  },
  {
    path: ['repo', 'list'],
    description: 'List repositories',
    run: ({ service }) => service.listRepos(),
  },
  {
    path: ['repo', 'show'],
    description: 'Show a repository',
    positionals: ['id'],
    run: ({ service, values }) => service.showRepo(getRequiredString(values, 'id')),
  },
  {
    path: ['repo', 'scan'],
    description: 'Scan a repository',
    positionals: ['id'],
    run: ({ service, values }) => service.scanRepo(getRequiredString(values, 'id')),
  },
  {
    path: ['repo', 'changes'],
    description: 'Report changed repository files',
    positionals: ['id'],
    options: [{ name: 'files', type: 'csv', required: true }],
    run: ({ service, values }) =>
      service.reportRepoChanges({
        id: getRequiredString(values, 'id'),
        files: getRequiredCsv(values, 'files'),
      } satisfies RepoChangesInput),
  },
  {
    path: ['fact', 'list'],
    description: 'List facts',
    run: ({ service }) => service.listFacts(),
  },
  {
    path: ['claim', 'list'],
    description: 'List claims',
    run: ({ service }) => service.listClaims(),
  },
  {
    path: ['claim', 'show'],
    description: 'Show a claim',
    positionals: ['id'],
    run: ({ service, values }) => service.showClaim(getRequiredString(values, 'id')),
  },
  {
    path: ['view', 'list'],
    description: 'List views',
    run: ({ service }) => service.listViews(),
  },
  {
    path: ['view', 'show'],
    description: 'Show a view',
    positionals: ['id'],
    run: ({ service, values }) => service.showView(getRequiredString(values, 'id')),
  },
  {
    path: ['view', 'rebuild'],
    description: 'Rebuild a view',
    positionals: ['id'],
    run: ({ service, values }) => service.rebuildView(getRequiredString(values, 'id')),
  },
  {
    path: ['bundle', 'plan'],
    description: 'Plan a bundle',
    options: [
      { name: 'task', type: 'string', required: true },
      { name: 'repo', type: 'csv', required: true },
      { name: 'parent-bundle', type: 'string' },
      { name: 'file-scope', type: 'csv' },
      { name: 'symbol-scope', type: 'csv' },
    ],
    run: ({ service, values }) =>
      service.planBundle({
        task: getRequiredString(values, 'task'),
        repoIds: getRequiredCsv(values, 'repo'),
        parentBundleId: getOptionalString(values, 'parent-bundle'),
        fileScope: getOptionalCsv(values, 'file-scope'),
        symbolScope: getOptionalCsv(values, 'symbol-scope'),
      } satisfies BundlePlanInput),
  },
  {
    path: ['bundle', 'show'],
    description: 'Show a bundle',
    positionals: ['id'],
    run: ({ service, values }) => service.showBundle(getRequiredString(values, 'id')),
  },
  {
    path: ['bundle', 'freshness'],
    description: 'Show bundle freshness',
    positionals: ['id'],
    run: ({ service, values }) => service.getBundleFreshness(getRequiredString(values, 'id')),
  },
  {
    path: ['bundle', 'expire'],
    description: 'Expire a bundle',
    positionals: ['id'],
    run: ({ service, values }) => service.expireBundle(getRequiredString(values, 'id')),
  },
  {
    path: ['bundle', 'cache', 'list'],
    description: 'List bundle cache entries',
    run: ({ service }) => service.listBundleCache(),
  },
  {
    path: ['bundle', 'cache', 'clear'],
    description: 'Clear bundle cache entries',
    run: ({ service }) => service.clearBundleCache(),
  },
  {
    path: ['freshness', 'impacts'],
    description: 'List freshness impacts',
    run: ({ service }) => service.getFreshnessImpacts(),
  },
  {
    path: ['freshness', 'recompute'],
    description: 'Recompute freshness state',
    run: ({ service }) => service.recomputeFreshness(),
  },
  {
    path: ['freshness', 'worker'],
    description: 'Drain queued freshness recompute jobs',
    options: [{ name: 'limit', type: 'string' }],
    run: ({ service, values }) =>
      service.runFreshnessWorker({
        limit: values.limit ? Number(getRequiredString(values, 'limit')) : undefined,
      }),
  },
  {
    path: ['freshness', 'status'],
    description: 'Show freshness status',
    run: ({ service }) => service.getFreshnessStatus(),
  },
  {
    path: ['receipt', 'submit'],
    description: 'Submit a receipt',
    options: [
      { name: 'bundle', type: 'string' },
      { name: 'agent', type: 'string', required: true },
      { name: 'summary', type: 'string', required: true },
    ],
    run: ({ service, values }) =>
      service.submitReceipt({
        bundleId: values.bundle ? getRequiredString(values, 'bundle') : null,
        agent: getRequiredString(values, 'agent'),
        summary: getRequiredString(values, 'summary'),
      } satisfies ReceiptSubmitInput),
  },
  {
    path: ['receipt', 'list'],
    description: 'List receipts',
    run: ({ service }) => service.listReceipts(),
  },
  {
    path: ['receipt', 'show'],
    description: 'Show a receipt',
    positionals: ['id'],
    run: ({ service, values }) => service.showReceipt(getRequiredString(values, 'id')),
  },
  {
    path: ['receipt', 'validate'],
    description: 'Validate a receipt',
    positionals: ['id'],
    run: ({ service, values }) => service.validateReceipt(getRequiredString(values, 'id')),
  },
  {
    path: ['receipt', 'reject'],
    description: 'Reject a receipt',
    positionals: ['id'],
    run: ({ service, values }) => service.rejectReceipt(getRequiredString(values, 'id')),
  },
];

export const runCli = async (
  argv: string[],
  service: ScbsService
): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
  try {
    const parsed = parseInput(argv);
    if (parsed.kind === 'help') {
      return { exitCode: 0, stdout: renderHelp(), stderr: '' };
    }

    const data = await parsed.definition.run({ values: parsed.values, service });
    const stdout = parsed.json ? toJson(parsed.commandName, data) : printValue(data);

    return { exitCode: 0, stdout, stderr: '' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown CLI error';
    return { exitCode: 1, stdout: '', stderr: message };
  }
};

export const renderHelp = (): string => {
  const lines = ['SCBS CLI', '', 'Commands:'];
  for (const definition of commandDefinitions) {
    lines.push(`  ${definition.path.join(' ')}  ${definition.description}`);
  }
  lines.push('', 'Every command accepts --json.');
  return lines.join('\n');
};

const parseInput = (argv: string[]): ParsedInput => {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    return { kind: 'help', json: false };
  }

  const json = argv.includes('--json');
  const normalized = argv.filter((token) => token !== '--json');
  const definition = matchDefinition(normalized);
  if (!definition) {
    throw new Error(renderHelp());
  }

  const values = parseValues(normalized.slice(definition.path.length), definition);
  const commandName = definition.path.join(' ');
  return { kind: 'command', json, definition, commandName, values };
};

const matchDefinition = (argv: string[]): CommandDefinition | undefined =>
  [...commandDefinitions]
    .sort((left, right) => right.path.length - left.path.length)
    .find((definition) => definition.path.every((segment, index) => argv[index] === segment));

const parseValues = (
  remaining: string[],
  definition: CommandDefinition
): Record<string, string | string[]> => {
  const values: Record<string, string | string[]> = {};
  const positionals = definition.positionals ?? [];
  let index = 0;

  for (const positional of positionals) {
    const token = remaining[index];
    if (!token || token.startsWith('--')) {
      throw new Error(`Missing required argument "${positional}".`);
    }

    values[positional] = token;
    index += 1;
  }

  while (index < remaining.length) {
    const token = remaining[index];
    if (!token?.startsWith('--')) {
      throw new Error(`Unexpected token "${token}".`);
    }

    const optionName = token.slice(2);
    const option = definition.options?.find((entry) => entry.name === optionName);
    if (!option) {
      throw new Error(`Unknown option "${token}".`);
    }

    const optionValue = remaining[index + 1];
    if (!optionValue || optionValue.startsWith('--')) {
      throw new Error(`Option "${token}" requires a value.`);
    }

    values[option.name] =
      option.type === 'csv'
        ? optionValue
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean)
        : optionValue;
    index += 2;
  }

  for (const option of definition.options ?? []) {
    if (option.required && !(option.name in values)) {
      throw new Error(`Missing required option "--${option.name}".`);
    }
  }

  return values;
};

const asString = (value: string | string[]): string => {
  if (typeof value !== 'string') {
    throw new Error('Expected a string value.');
  }

  return value;
};

const asCsv = (value: string | string[]): string[] => {
  if (Array.isArray(value)) {
    return value;
  }

  return [value];
};

const getRequiredString = (values: Record<string, string | string[]>, key: string): string => {
  const value = values[key];
  if (value === undefined) {
    throw new Error(`Missing value "${key}".`);
  }

  return asString(value);
};

const getRequiredCsv = (values: Record<string, string | string[]>, key: string): string[] => {
  const value = values[key];
  if (value === undefined) {
    throw new Error(`Missing value "${key}".`);
  }

  return asCsv(value);
};

const getOptionalString = (
  values: Record<string, string | string[]>,
  key: string
): string | undefined => {
  const value = values[key];
  return value === undefined ? undefined : asString(value);
};

const getOptionalCsv = (
  values: Record<string, string | string[]>,
  key: string
): string[] | undefined => {
  const value = values[key];
  return value === undefined ? undefined : asCsv(value);
};
