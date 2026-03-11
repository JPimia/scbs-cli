#!/usr/bin/env node

import { runCli } from './cli';
import { createDurableScbsService } from './durable-service';

const result = await runCli(process.argv.slice(2), createDurableScbsService());

if (result.stdout) {
  console.log(result.stdout);
}

if (result.stderr) {
  console.error(result.stderr);
}

process.exit(result.exitCode);
