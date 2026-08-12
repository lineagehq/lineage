import type express from 'express';
import { connectBuffer, getBufferConnection } from './bufferConnection';
import { listBufferChannels, syncBufferChannels } from './bufferChannelSync';
import type { BufferReadRuntime } from './bufferRuntime';

type ProjectFrom = (input: { body?: Record<string, unknown>; query?: Record<string, unknown> }) => string;
type AsyncRoute = (handler: (req: express.Request, res: express.Response) => Promise<void> | void) => express.RequestHandler;
export function registerBufferRoutes(app: express.Express, projectFrom: ProjectFrom, asyncRoute: AsyncRoute, deps: { env?: NodeJS.ProcessEnv; runtime?: BufferReadRuntime } = {}): void {
  app.get('/api/adapters/buffer/connection', asyncRoute((req, res) => { res.json({ ok: true, connection: getBufferConnection(projectFrom(req)) }); }));
  app.post('/api/adapters/buffer/connection', asyncRoute((req, res) => { res.json({ ok: true, connection: connectBuffer(projectFrom(req), { organizationId: String(req.body.organizationId || ''), credentialRef: typeof req.body.credentialRef === 'string' ? req.body.credentialRef : undefined, confirmWrite: req.body.confirmWrite === true }, deps.env, deps.runtime) }); }));
  app.get('/api/adapters/buffer/channels', asyncRoute((req, res) => { res.json({ ok: true, project: projectFrom(req), channels: listBufferChannels(projectFrom(req)) }); }));
  app.post('/api/adapters/buffer/channels', asyncRoute((req, res) => { res.json({ ok: true, ...syncBufferChannels(projectFrom(req), { confirmWrite: req.body.confirmWrite === true }, { env: deps.env, runtime: deps.runtime }) }); }));
}
