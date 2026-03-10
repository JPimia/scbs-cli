#!/usr/bin/env node

import { runCli } from './cli';
import { createInMemoryScbsService } from './in-memory-service';

const result = await runCli(process.argv.slice(2), createInMemoryScbsService());

if (result.stdout) {
  console.log(result.stdout);
}

if (result.stderr) {
  console.error(result.stderr);
}

process.exit(result.exitCode);
