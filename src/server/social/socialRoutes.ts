import type express from 'express';
import { listAssetSocialMarks, markAssetSocial, unmarkAssetSocial } from './socialMarks';

type ProjectFrom = (input: { body?: Record<string, unknown>; query?: Record<string, unknown> }) => string;
type AsyncRoute = (handler: (req: express.Request, res: express.Response) => Promise<void> | void) => express.RequestHandler;

function bodyString(req: express.Request, key: string): string | undefined {
  const value = (req.body as Record<string, unknown> | undefined)?.[key];
  return typeof value === 'string' ? value : undefined;
}

function requestClaimToken(req: express.Request): string | undefined {
  return req.header('X-Lineage-Claim-Token') || bodyString(req, 'claimToken');
}

export function registerSocialMarkRoutes(app: express.Express, projectFrom: ProjectFrom, asyncRoute: AsyncRoute): void {
  app.get('/api/lineage/:rootAssetId/social-marks', asyncRoute((req, res) => {
    res.json(listAssetSocialMarks(
      projectFrom({ query: req.query }),
      req.params.rootAssetId,
    ));
  }));
  app.post('/api/lineage/:rootAssetId/social-marks/:assetId', asyncRoute((req, res) => {
    res.json(markAssetSocial(projectFrom({ body: req.body as Record<string, unknown>, query: req.query }), {
      asset: req.params.assetId,
      claimToken: requestClaimToken(req),
      confirmWrite: req.body?.confirmWrite === true,
      markedBy: bodyString(req, 'markedBy') || bodyString(req, 'actor') || 'human',
      notes: bodyString(req, 'notes'),
      rootAssetId: req.params.rootAssetId,
    }));
  }));
  app.post('/api/lineage/:rootAssetId/social-marks/:assetId/unmark', asyncRoute((req, res) => {
    res.json(unmarkAssetSocial(projectFrom({ body: req.body as Record<string, unknown>, query: req.query }), {
      asset: req.params.assetId,
      claimToken: requestClaimToken(req),
      confirmWrite: req.body?.confirmWrite === true,
      rootAssetId: req.params.rootAssetId,
      unmarkedBy: bodyString(req, 'unmarkedBy') || bodyString(req, 'actor') || 'human',
    }));
  }));
}
