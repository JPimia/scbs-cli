import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';

import { handleApiRequest } from './http';
import type { ServeReport, ServerScbsService } from './types';

export function createScbsHttpHandler(service: ServerScbsService, report: ServeReport) {
  return (request: IncomingMessage, response: ServerResponse) =>
    void handleApiRequest(request, response, service, report);
}

export function createScbsHttpServer(service: ServerScbsService, report: ServeReport): Server {
  return createServer(createScbsHttpHandler(service, report));
}
