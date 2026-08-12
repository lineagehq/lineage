import type express from 'express';
import {
  assertProjectWorkspaceAvailable,
  createProjectWorkspace,
  deleteProject,
  deleteWorkspace,
  demoBootstrapSuppressed,
  inspectProjectWorkspace,
  listProjectCollection,
  listWorkspaceCollection,
  planProjectDeletion,
  planWorkspaceDeletion,
  ProjectWorkspaceError,
  reorderProjects,
  reorderWorkspaces,
  restoreWorkspace,
  swissifierDemoProject,
} from './projectWorkspaces';
import {
  restoreSwissifierRichDemoProject,
  swissifierRichDemoRootAssetId,
} from './assetLineageDemo';
import { inspectLineageWorkspace } from './assetLineageWorkspaces';
import type { CollectionSort, WorkspaceCollectionKind } from '../shared/types';

type AsyncRoute = (handler: (req: express.Request, res: express.Response) => Promise<void> | void) => express.RequestHandler;
type ProjectFrom = (input: { body?: Record<string, unknown>; query?: Record<string, unknown> }) => string;

function collectionSort(value: unknown): CollectionSort {
  return value === 'name' || value === 'updated' ? value : 'manual';
}

function workspaceCollection(value: unknown): WorkspaceCollectionKind {
  return value === 'archived' ? 'archived' : 'open';
}

function reorderTarget(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ProjectWorkspaceError('Reorder targetIndex must be a finite number', 400, 'invalid_target_index');
  }
  return value;
}

export function registerProjectWorkspaceRoutes(app: express.Express, asyncRoute: AsyncRoute): void {
  app.get('/api/projects', asyncRoute((req, res) => {
    res.json(listProjectCollection({
      page: Number(req.query.page || 1),
      pageSize: Number(req.query.pageSize || 12),
      query: typeof req.query.q === 'string' ? req.query.q : undefined,
      sort: collectionSort(req.query.sort),
    }));
  }));

  app.get('/api/projects/demo/swissifier/entry', asyncRoute((_req, res) => {
    const project = demoBootstrapSuppressed() ? null : inspectProjectWorkspace(swissifierDemoProject);
    let workspace;
    try {
      const candidate = project
        ? inspectLineageWorkspace(swissifierDemoProject, swissifierRichDemoRootAssetId(swissifierDemoProject))
        : undefined;
      workspace = candidate?.status === 'archived' ? undefined : candidate;
    } catch {
      workspace = undefined;
    }
    if (!project || !workspace) {
      res.status(404).json({
        error: 'Swissifier Demo was deleted. Restore it explicitly before opening.',
        code: 'demo_suppressed',
      });
      return;
    }
    res.json({ ok: true, project, workspace });
  }));

  app.post('/api/projects/demo/swissifier/restore', asyncRoute((req, res) => {
    const result = restoreSwissifierRichDemoProject(req.body.confirmWrite === true);
    res.json(result);
  }));

  app.post('/api/projects', asyncRoute((req, res) => {
    res.json(createProjectWorkspace({
      id: String(req.body.id || req.body.project || ''),
      displayName: String(req.body.displayName || req.body.product || ''),
      defaultBucket: typeof req.body.defaultBucket === 'string' ? req.body.defaultBucket : undefined,
      defaultRegion: typeof req.body.defaultRegion === 'string' ? req.body.defaultRegion : undefined,
      confirmWrite: req.body.confirmWrite === true,
    }));
  }));

  app.post('/api/projects/reorder', asyncRoute((req, res) => {
    res.json(reorderProjects({
      itemId: String(req.body.itemId || ''),
      targetIndex: reorderTarget(req.body.targetIndex),
      expectedRevision: Number(req.body.expectedRevision),
      confirmWrite: req.body.confirmWrite === true,
    }));
  }));

  app.get('/api/projects/:project', asyncRoute((req, res) => {
    res.json({ ok: true, project: inspectProjectWorkspace(req.params.project) });
  }));

  app.get('/api/projects/:project/workspaces', asyncRoute((req, res) => {
    res.json(listWorkspaceCollection(req.params.project, {
      collection: workspaceCollection(req.query.collection),
      page: Number(req.query.page || 1),
      pageSize: Number(req.query.pageSize || 12),
      query: typeof req.query.q === 'string' ? req.query.q : undefined,
      sort: collectionSort(req.query.sort),
    }));
  }));

  app.post('/api/projects/:project/workspaces/reorder', asyncRoute((req, res) => {
    res.json(reorderWorkspaces(req.params.project, workspaceCollection(req.body.collection), {
      itemId: String(req.body.itemId || ''),
      targetIndex: reorderTarget(req.body.targetIndex),
      expectedRevision: Number(req.body.expectedRevision),
      confirmWrite: req.body.confirmWrite === true,
    }));
  }));

  app.post('/api/projects/:project/workspaces/:workspaceId/restore', asyncRoute((req, res) => {
    res.json(restoreWorkspace(req.params.project, req.params.workspaceId, req.body.confirmWrite === true));
  }));

  app.get('/api/projects/:project/workspaces/:workspaceId/deletion-plan', asyncRoute((req, res) => {
    res.json({ ok: true, plan: planWorkspaceDeletion(req.params.project, req.params.workspaceId) });
  }));

  app.post('/api/projects/:project/workspaces/:workspaceId/delete', asyncRoute((req, res) => {
    res.json(deleteWorkspace(req.params.project, req.params.workspaceId, {
      expectedDigest: String(req.body.expectedDigest || ''),
      confirmWrite: req.body.confirmWrite === true,
    }));
  }));

  app.get('/api/projects/:project/deletion-plan', asyncRoute((req, res) => {
    res.json({ ok: true, plan: planProjectDeletion(req.params.project) });
  }));

  app.post('/api/projects/:project/delete', asyncRoute((req, res) => {
    res.json(deleteProject(req.params.project, {
      expectedDigest: String(req.body.expectedDigest || ''),
      confirmation: String(req.body.confirmation || ''),
      confirmWrite: req.body.confirmWrite === true,
    }));
  }));
}

export function projectLifecycleGate(projectFrom: ProjectFrom): express.RequestHandler {
  return (req, _res, next) => {
    try {
      assertProjectWorkspaceAvailable(projectFrom(req));
      next();
    } catch (error) {
      next(error);
    }
  };
}
