#!/usr/bin/env node

import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';

import { runCli } from './cli';
import { createDurableScbsService } from './durable-service';
import { printValue, toJson } from './format';
import { handleApiRequest } from './http';
import type { ScbsService } from './service';
import type { ServeReport } from './types';

const argv = process.argv.slice(2);
const service = createDurableScbsService({ cwd: process.env.SCBS_CWD ?? process.cwd() });

if (isServeCommand(argv)) {
  const exitCode = await runServeProcess(argv, service);
  process.exit(exitCode);
}

const result = await runCli(argv, service);

if (result.stdout) {
  console.log(result.stdout);
}

if (result.stderr) {
  console.error(result.stderr);
}

process.exit(result.exitCode);

function isServeCommand(argv: string[]): boolean {
  const normalized = argv.filter((token) => token !== '--json');
  return normalized[0] === 'serve';
}

async function runServeProcess(argv: string[], service: ScbsService): Promise<number> {
  try {
    const report = await service.serve();
    const server = createServer((request, response) => {
      void handleRequest(request, response, service, report);
    });

    await listen(server, report);

    const output = argv.includes('--json') ? toJson('serve', report) : printValue(report);
    console.log(output);

    await waitForShutdown(server);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown CLI error';
    console.error(message);
    return 1;
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  service: ScbsService,
  report: ServeReport
): Promise<void> {
  return handleApiRequest(request, response, service, report);
}

async function listen(server: ReturnType<typeof createServer>, report: ServeReport): Promise<void> {
  const baseUrl = new URL(report.api.baseUrl);
  const host = baseUrl.hostname;
  const port = Number(baseUrl.port || (baseUrl.protocol === 'https:' ? 443 : 80));

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

async function waitForShutdown(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const shutdown = () => {
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}
