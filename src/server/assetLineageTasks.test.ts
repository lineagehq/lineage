import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useLineageTestProfile } from '../test/lineageTestProfile';
import { defaultProject, repoRoot } from './assetCore';
import { getLineageSnapshot, indexLineageAssets, linkLineageAssets, markLineageRerollRequest, updateSelectedAsset } from './assetLineage';
import { backfillLineageTasks, lineageDb } from './assetLineageDb';
import { inspectAgentClaim, listAgentClaims } from './agentClaims';
import {
  addLineageTaskComment,
  cancelLineageIterateTasksForAssets,
  cancelLineageTask,
  claimLineageTask,
  getLineageTask,
  listLineageTasks,
  overrideLineageTask,
  resolveLineageTask,
  startLineageTask,
  taskIdFor,
  updateLineageTaskInstructions,
  upsertLineageTask,
} from './assetLineageTasks';
import { registerLineageTaskRoutes } from './lineageTaskRoutes';
import { fileSha256 } from './localReview';

const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-lineage-tasks');
const dbFile = join(scratchDir, 'asset-lineage-tasks.sqlite');
let server: ReturnType<express.Express['listen']> | null = null;

function localId(file: string): string {
  return `local-${fileSha256(file).slice(0, 12)}`;
}

function seedFiles() {
  mkdirSync(scratchDir, { recursive: true });
  const root = join(scratchDir, 'task-root.png');
  const child = join(scratchDir, 'task-child.png');
  const alternate = join(scratchDir, 'task-alternate.png');
  writeFileSync(root, Buffer.from('lineage-task-root'));
  writeFileSync(child, Buffer.from('lineage-task-child'));
  writeFileSync(alternate, Buffer.from('lineage-task-alternate'));
  return {
    alternateId: localId(alternate),
    childId: localId(child),
    rootId: localId(root),
  };
}

function seedLineage() {
  const files = seedFiles();
  indexLineageAssets(defaultProject);
  linkLineageAssets(defaultProject, {
    childAssetId: files.childId,
    confirmWrite: true,
    parentAssetId: files.rootId,
  });
  return files;
}

function taskEventTypes(taskId: string): string[] {
  return getLineageTask(defaultProject, taskId).events.map(event => event.event_type);
}

function projectFrom(input: { body?: Record<string, unknown>; query?: Record<string, unknown> }): string {
  const candidate = input.body?.project || input.query?.project;
  return typeof candidate === 'string' ? candidate : defaultProject;
}

function asyncRoute(handler: (req: express.Request, res: express.Response) => Promise<void> | void): express.RequestHandler {
  return (req, res, next) => { Promise.resolve(handler(req, res)).catch(next); };
}

function appWithLineageTaskRoutes() {
  const app = express();
  app.use(express.json());
  registerLineageTaskRoutes(app, projectFrom, asyncRoute);
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : 500;
    res.status(status).json({ error: error instanceof Error ? error.message : String(error) });
  });
  server = app.listen(0);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function getJson<T>(baseUrl: string, path: string): Promise<{ body: T; status: number }> {
  const response = await fetch(`${baseUrl}${path}`);
  return { body: await response.json() as T, status: response.status };
}

async function postJson<T>(baseUrl: string, path: string, body: Record<string, unknown>): Promise<{ body: T; status: number }> {
  const response = await fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  return { body: await response.json() as T, status: response.status };
}

describe('asset lineage tasks', () => {
  beforeEach(() => {
    rmSync(scratchDir, { force: true, recursive: true });
    useLineageTestProfile(dbFile);
  });

  afterEach(() => {
    server?.close();
    server = null;
  });

  it('upserts one open iterate task per target and records created then instructions_updated', () => {
    const files = seedLineage();

    const created = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: 'Try brighter composition.',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'iterate',
    });
    const updated = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: 'Try brighter composition with more whitespace.',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'iterate',
    });

    expect(created.task.id).toBe(taskIdFor(defaultProject, files.rootId, files.childId, 'iterate'));
    expect(created.ok).toBe(true);
    expect(updated.ok).toBe(true);
    expect(updated.task.instructions).toBe('Try brighter composition with more whitespace.');
    expect(listLineageTasks(defaultProject, files.rootId).tasks).toHaveLength(1);
    expect(taskEventTypes(updated.task.id)).toEqual(['created', 'instructions_updated']);
  });

  it('claim and start lock instruction edits but allow comments without persisting raw claim tokens', () => {
    const files = seedLineage();
    const created = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: 'Explore a tighter crop.',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'iterate',
    });

    const claimed = claimLineageTask(defaultProject, {
      agentName: 'Task worker',
      taskId: created.task.id,
    });
    const claimToken = claimed.claim_token;

    expect(claimed.task).toMatchObject({ status: 'claimed', claimed_by_claim_id: claimed.claim.id });
    expect(() => updateLineageTaskInstructions(defaultProject, {
      instructions: 'This edit should be rejected.',
      taskId: created.task.id,
    })).toThrow('pending');

    const commented = addLineageTaskComment(defaultProject, {
      actor: 'human',
      message: 'Keep the original palette.',
      taskId: created.task.id,
    });
    expect(commented.task.instructions).toBe('Explore a tighter crop.');
    expect(commented.events.map(event => event.event_type)).toContain('comment_added');

    const started = startLineageTask(defaultProject, {
      claimToken,
      taskId: created.task.id,
    });

    expect(started.task).toMatchObject({ status: 'in_progress', claimed_by_claim_id: claimed.claim.id });
    expect(() => updateLineageTaskInstructions(defaultProject, {
      instructions: 'This edit should also be rejected.',
      taskId: created.task.id,
    })).toThrow('pending');
    expect(JSON.stringify(started)).not.toContain(claimToken);
    expect(taskEventTypes(created.task.id)).toEqual(['created', 'claimed', 'comment_added', 'started']);
  });

  it('keeps promptless variation tasks visible but blocks agent execution until a prompt is saved', () => {
    const files = seedLineage();
    const created = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: null,
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'iterate',
    });

    expect(created.task).toMatchObject({ prompt_status: 'needs_prompt', status: 'pending' });
    expect(() => claimLineageTask(defaultProject, {
      agentName: 'Task worker',
      taskId: created.task.id,
    })).toThrow('needs a variation prompt before it can be claimed');
    expect(listAgentClaims(defaultProject).claims.filter(claim =>
      claim.scope_type === 'lineage_task' && claim.target_id === created.task.id
    )).toHaveLength(0);

    const prompted = updateLineageTaskInstructions(defaultProject, {
      instructions: 'Create a quieter editorial variation.',
      taskId: created.task.id,
    });
    expect(prompted.task.prompt_status).toBe('ready');

    const claimed = claimLineageTask(defaultProject, {
      agentName: 'Task worker',
      taskId: created.task.id,
    });
    const database = lineageDb();
    try {
      database.prepare('update lineage_tasks set instructions = null where id = ?').run(created.task.id);
    } finally {
      database.close();
    }
    expect(() => startLineageTask(defaultProject, {
      claimToken: claimed.claim_token,
      taskId: created.task.id,
    })).toThrow('needs a variation prompt before it can be started');
  });

  it('keeps Canvas branch and re-roll prompts synchronized with task instruction edits', () => {
    const files = seedLineage();
    updateSelectedAsset(defaultProject, {
      assetId: files.childId,
      confirmWrite: true,
      rootAssetId: files.rootId,
    });
    markLineageRerollRequest(defaultProject, {
      confirmWrite: true,
      nodeAssetId: files.childId,
      notes: '',
      requestedBy: 'human',
      rootAssetId: files.rootId,
    });
    const tasks = listLineageTasks(defaultProject, files.rootId).tasks;
    const iterateTask = tasks.find(task => task.task_type === 'iterate')!;
    const rerollTask = tasks.find(task => task.task_type === 'reroll')!;

    updateLineageTaskInstructions(defaultProject, {
      instructions: 'Use a tighter editorial grid.',
      taskId: iterateTask.id,
    });
    updateLineageTaskInstructions(defaultProject, {
      instructions: 'Keep the layout and repair the headline.',
      taskId: rerollTask.id,
    });

    const snapshot = getLineageSnapshot(defaultProject, files.rootId);
    const child = snapshot.nodes.find(node => node.asset_id === files.childId);
    expect(child?.branch_prompt).toBe('Use a tighter editorial grid.');
    expect(child?.reroll_request).toMatchObject({
      prompt: 'Keep the layout and repair the headline.',
      prompt_status: 'ready',
    });
    expect(snapshot.tasks?.every(task => task.prompt_status === 'ready')).toBe(true);
  });

  it('does not create a second claim or event when claiming an already claimed task', () => {
    const files = seedLineage();
    const created = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: 'Keep this task claimed.',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'iterate',
    });
    const claimed = claimLineageTask(defaultProject, {
      agentName: 'First task worker',
      taskId: created.task.id,
    });

    expect(() => claimLineageTask(defaultProject, {
      agentName: 'Second task worker',
      taskId: created.task.id,
    })).toThrow('Only pending lineage tasks can be claimed.');

    const activeTaskClaims = listAgentClaims(defaultProject).claims.filter(claim =>
      claim.scope_type === 'lineage_task' && claim.target_id === created.task.id && claim.status === 'active'
    );
    expect(activeTaskClaims.map(claim => claim.id)).toEqual([claimed.claim.id]);
    expect(taskEventTypes(created.task.id)).toEqual(['created', 'claimed']);
  });

  it('rejects upsert instruction edits for claimed and in-progress tasks', () => {
    const files = seedLineage();
    const claimedTask = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: 'Keep the main branch focused.',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'iterate',
    });
    claimLineageTask(defaultProject, {
      agentName: 'Claimed task worker',
      taskId: claimedTask.task.id,
    });

    const inProgressTask = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: 'Explore the alternate branch.',
      rootAssetId: files.rootId,
      targetAssetId: files.alternateId,
      taskType: 'iterate',
    });
    const claimedInProgress = claimLineageTask(defaultProject, {
      agentName: 'Started task worker',
      taskId: inProgressTask.task.id,
    });
    startLineageTask(defaultProject, {
      claimToken: claimedInProgress.claim_token,
      taskId: inProgressTask.task.id,
    });

    expect(() => upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: 'Do not accept this claimed edit.',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'iterate',
    })).toThrow('pending');
    expect(() => upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: 'Do not accept this in-progress edit.',
      rootAssetId: files.rootId,
      targetAssetId: files.alternateId,
      taskType: 'iterate',
    })).toThrow('pending');

    expect(getLineageTask(defaultProject, claimedTask.task.id).task.instructions).toBe('Keep the main branch focused.');
    expect(getLineageTask(defaultProject, inProgressTask.task.id).task.instructions).toBe('Explore the alternate branch.');
  });

  it('rejects bogus claim tokens when starting and leaves the task claimed', () => {
    const files = seedLineage();
    const created = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: 'Only the real claim holder may start.',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'iterate',
    });
    claimLineageTask(defaultProject, {
      agentName: 'Task worker',
      taskId: created.task.id,
    });

    expect(() => startLineageTask(defaultProject, {
      claimToken: 'claim_fake.invalid',
      taskId: created.task.id,
    })).toThrow('Unknown or invalid claim token');

    const inspected = getLineageTask(defaultProject, created.task.id);
    expect(inspected.task.status).toBe('claimed');
    expect(inspected.events.map(event => event.event_type)).toEqual(['created', 'claimed']);
  });

  it('records claim write permission only after a successful task start', () => {
    const files = seedLineage();
    const created = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: 'Start exactly once.',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'iterate',
    });
    const claimed = claimLineageTask(defaultProject, {
      agentName: 'Task worker',
      taskId: created.task.id,
    });

    startLineageTask(defaultProject, {
      claimToken: claimed.claim_token,
      taskId: created.task.id,
    });
    expect(() => startLineageTask(defaultProject, {
      claimToken: claimed.claim_token,
      taskId: created.task.id,
    })).toThrow('Only claimed lineage tasks can be started.');

    const claimEvents = inspectAgentClaim(claimed.claim.id, defaultProject).events;
    expect(claimEvents.filter(event => event.event_type === 'write_allowed')).toHaveLength(1);
  });

  it('returns an active claimed task to pending when a human override is recorded', () => {
    const files = seedLineage();
    const created = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: 'Original task instructions.',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'iterate',
    });
    const claimed = claimLineageTask(defaultProject, {
      agentName: 'Task worker',
      taskId: created.task.id,
    });

    const overridden = overrideLineageTask(defaultProject, {
      actor: 'human',
      instructions: 'Updated after override.',
      reason: 'Worker stopped responding.',
      taskId: created.task.id,
    });

    expect(overridden.ok).toBe(true);
    expect(overridden.task).toMatchObject({
      claimed_at: undefined,
      claimed_by_claim_id: undefined,
      instructions: 'Updated after override.',
      started_at: undefined,
      status: 'pending',
    });
    expect(overridden.task.metadata?.claim_id).toBeUndefined();
    expect(overridden.events.map(event => event.event_type)).toEqual(['created', 'claimed', 'human_override']);
    expect(overridden.events.at(-1)).toMatchObject({
      actor: 'human',
      message: 'Worker stopped responding.',
      metadata: { previous_status: 'claimed' },
    });
    expect(inspectAgentClaim(claimed.claim.id, defaultProject).claim.status).toBe('revoked');
  });

  it('revokes the active claim and records a human override when cancelling a locked task', () => {
    const files = seedLineage();
    const created = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: 'Cancel this active task.',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'iterate',
    });
    const claimed = claimLineageTask(defaultProject, {
      agentName: 'Task worker',
      taskId: created.task.id,
    });
    startLineageTask(defaultProject, {
      claimToken: claimed.claim_token,
      taskId: created.task.id,
    });

    const cancelled = cancelLineageTask(defaultProject, {
      actor: 'human',
      confirmWrite: true,
      override: true,
      taskId: created.task.id,
    });

    expect(cancelled.task).toMatchObject({
      claimed_at: undefined,
      claimed_by_claim_id: undefined,
      started_at: undefined,
      status: 'cancelled',
    });
    expect(cancelled.events.map(event => event.event_type)).toEqual(['created', 'claimed', 'started', 'human_override', 'cancelled']);
    expect(inspectAgentClaim(claimed.claim.id, defaultProject).claim.status).toBe('revoked');
  });

  it('previews active cancel overrides with the same unlocked task shape as confirmed writes', () => {
    const files = seedLineage();
    const created = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: 'Preview cancelling this active task.',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'iterate',
    });
    const claimed = claimLineageTask(defaultProject, {
      agentName: 'Task worker',
      taskId: created.task.id,
    });
    startLineageTask(defaultProject, {
      claimToken: claimed.claim_token,
      taskId: created.task.id,
    });

    const dryRun = cancelLineageTask(defaultProject, {
      actor: 'human',
      confirmWrite: false,
      override: true,
      taskId: created.task.id,
    });

    expect(dryRun).toMatchObject({ dryRun: true });
    expect(dryRun.task).toMatchObject({
      claimed_at: undefined,
      claimed_by_claim_id: undefined,
      started_at: undefined,
      status: 'cancelled',
    });
    expect(inspectAgentClaim(claimed.claim.id, defaultProject).claim.status).toBe('active');
  });

  it('does not override pending or closed lineage tasks', () => {
    const files = seedLineage();
    const created = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'iterate',
    });

    expect(() => overrideLineageTask(defaultProject, {
      actor: 'human',
      reason: 'No active worker.',
      taskId: created.task.id,
    })).toThrow('claimed or in-progress');

    cancelLineageTask(defaultProject, {
      actor: 'human',
      confirmWrite: true,
      taskId: created.task.id,
    });
    expect(() => overrideLineageTask(defaultProject, {
      actor: 'human',
      reason: 'Closed task stays closed.',
      taskId: created.task.id,
    })).toThrow('claimed or in-progress');
  });

  it('serves lineage task list and update routes', async () => {
    const files = seedLineage();
    const created = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: 'Initial route instructions.',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'iterate',
    });
    const baseUrl = appWithLineageTaskRoutes();

    const listed = await getJson<{ tasks: Array<{ id: string; instructions?: string }> }>(
      baseUrl,
      `/api/lineage/${files.rootId}/tasks?project=${encodeURIComponent(defaultProject)}`
    );
    const updated = await postJson<{ task: { id: string; instructions?: string } }>(
      baseUrl,
      `/api/lineage/tasks/${encodeURIComponent(created.task.id)}/instructions`,
      { instructions: 'Route-updated instructions.', project: defaultProject }
    );

    expect(listed.status).toBe(200);
    expect(listed.body.tasks.map(task => task.id)).toEqual([created.task.id]);
    expect(updated.status).toBe(200);
    expect(updated.body.task).toMatchObject({
      id: created.task.id,
      instructions: 'Route-updated instructions.',
    });
  });

  it('keeps a locked task locked when adding a comment through the route', async () => {
    const files = seedLineage();
    const created = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: 'Keep this route task locked.',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'iterate',
    });
    const claimed = claimLineageTask(defaultProject, {
      agentName: 'Task route worker',
      taskId: created.task.id,
    });
    const baseUrl = appWithLineageTaskRoutes();

    const commented = await postJson<{ task: { status: string; claimed_by_claim_id?: string }; events: Array<{ event_type: string }> }>(
      baseUrl,
      `/api/lineage/tasks/${encodeURIComponent(created.task.id)}/comment`,
      { actor: 'human', message: 'Please keep the current palette.', project: defaultProject }
    );
    const empty = await postJson<{ error: string }>(
      baseUrl,
      `/api/lineage/tasks/${encodeURIComponent(created.task.id)}/comment`,
      { actor: 'human', message: '', project: defaultProject }
    );

    expect(commented.status).toBe(200);
    expect(commented.body.task).toMatchObject({
      claimed_by_claim_id: claimed.claim.id,
      status: 'claimed',
    });
    expect(commented.body.events.map(event => event.event_type)).toContain('comment_added');
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe('Comment message is required');
  });

  it('claims and starts a task through routes using snake_case and camelCase body aliases', async () => {
    const files = seedLineage();
    const created = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: 'Run this route task.',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'iterate',
    });
    const baseUrl = appWithLineageTaskRoutes();

    const claimed = await postJson<{ claim_token: string; task: { status: string; claimed_by_claim_id?: string } }>(
      baseUrl,
      `/api/lineage/tasks/${encodeURIComponent(created.task.id)}/claim`,
      { agent_name: 'Snake route worker', project: defaultProject }
    );
    const started = await postJson<{ task: { status: string; claimed_by_claim_id?: string } }>(
      baseUrl,
      `/api/lineage/tasks/${encodeURIComponent(created.task.id)}/start`,
      { claimToken: claimed.body.claim_token, project: defaultProject }
    );

    expect(claimed.status).toBe(200);
    expect(claimed.body.task.status).toBe('claimed');
    expect(claimed.body.claim_token).toMatch(/^claim_/);
    expect(started.status).toBe(200);
    expect(started.body.task).toMatchObject({
      claimed_by_claim_id: claimed.body.task.claimed_by_claim_id,
      status: 'in_progress',
    });
    expect(JSON.stringify(started.body)).not.toContain(claimed.body.claim_token);
  });

  it('overrides an active task through the route and returns it to pending', async () => {
    const files = seedLineage();
    const created = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: 'Route task before override.',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'iterate',
    });
    const claimed = claimLineageTask(defaultProject, {
      agentName: 'Override route worker',
      taskId: created.task.id,
    });
    startLineageTask(defaultProject, {
      claimToken: claimed.claim_token,
      taskId: created.task.id,
    });
    const baseUrl = appWithLineageTaskRoutes();

    const overridden = await postJson<{ task: { instructions?: string; status: string }; events: Array<{ event_type: string }> }>(
      baseUrl,
      `/api/lineage/tasks/${encodeURIComponent(created.task.id)}/override`,
      {
        actor: 'human',
        instructions: 'Route task after override.',
        project: defaultProject,
        reason: 'Human is taking this back.',
      }
    );

    expect(overridden.status).toBe(200);
    expect(overridden.body.task).toMatchObject({
      instructions: 'Route task after override.',
      status: 'pending',
    });
    expect(overridden.body.events.map(event => event.event_type)).toContain('human_override');
    expect(getLineageTask(defaultProject, created.task.id).task).toMatchObject({
      instructions: 'Route task after override.',
      status: 'pending',
    });
  });

  it('routes cancellation through confirmWrite and override safeguards', async () => {
    const files = seedLineage();
    const pending = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      rootAssetId: files.rootId,
      targetAssetId: files.rootId,
      taskType: 'iterate',
    });
    const active = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: 'Keep this route task active.',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'iterate',
    });
    claimLineageTask(defaultProject, {
      agentName: 'Active route worker',
      taskId: active.task.id,
    });
    const baseUrl = appWithLineageTaskRoutes();

    const dryRun = await postJson<{ dryRun?: true; task: { status: string } }>(
      baseUrl,
      `/api/lineage/tasks/${encodeURIComponent(pending.task.id)}/cancel`,
      { actor: 'human', confirmWrite: false, project: defaultProject }
    );
    const denied = await postJson<{ error: string }>(
      baseUrl,
      `/api/lineage/tasks/${encodeURIComponent(active.task.id)}/cancel`,
      { actor: 'human', confirmWrite: true, project: defaultProject }
    );
    const cancelled = await postJson<{ task: { status: string } }>(
      baseUrl,
      `/api/lineage/tasks/${encodeURIComponent(active.task.id)}/cancel`,
      { actor: 'human', confirm_write: true, override: true, project: defaultProject }
    );

    expect(dryRun.status).toBe(200);
    expect(dryRun.body).toMatchObject({ dryRun: true, task: { status: 'cancelled' } });
    expect(getLineageTask(defaultProject, pending.task.id).task.status).toBe('pending');
    expect(denied.status).toBe(409);
    expect(denied.body.error).toContain('override=true');
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.task.status).toBe('cancelled');
    expect(getLineageTask(defaultProject, active.task.id).task.status).toBe('cancelled');
  });

  it('cancels pending tasks with dry-run support and hides them from the default list', () => {
    const files = seedLineage();
    const created = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'iterate',
    });

    const dryRun = cancelLineageTask(defaultProject, {
      actor: 'human',
      confirmWrite: false,
      taskId: created.task.id,
    });
    expect(dryRun).toMatchObject({ dryRun: true, ok: true });
    expect(listLineageTasks(defaultProject, files.rootId).tasks.map(task => task.id)).toContain(created.task.id);

    const cancelled = cancelLineageTask(defaultProject, {
      actor: 'human',
      confirmWrite: true,
      taskId: created.task.id,
    });

    expect(cancelled.ok).toBe(true);
    expect(cancelled.task.status).toBe('cancelled');
    expect(listLineageTasks(defaultProject, files.rootId).tasks).toHaveLength(0);
    expect(listLineageTasks(defaultProject, files.rootId, ['cancelled']).tasks.map(task => task.id)).toEqual([created.task.id]);
  });

  it('requires override to cancel active tasks', () => {
    const files = seedLineage();
    const created = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: 'Keep this task active until overridden.',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'iterate',
    });
    const claimed = claimLineageTask(defaultProject, {
      agentName: 'Task worker',
      taskId: created.task.id,
    });
    startLineageTask(defaultProject, {
      claimToken: claimed.claim_token,
      taskId: created.task.id,
    });

    expect(() => cancelLineageTask(defaultProject, {
      actor: 'human',
      confirmWrite: true,
      taskId: created.task.id,
    })).toThrow('override=true');
    expect(getLineageTask(defaultProject, created.task.id).task.status).toBe('in_progress');

    const cancelled = cancelLineageTask(defaultProject, {
      actor: 'human',
      confirmWrite: true,
      override: true,
      taskId: created.task.id,
    });

    expect(cancelled.task.status).toBe('cancelled');
    expect(listLineageTasks(defaultProject, files.rootId).tasks).toHaveLength(0);
    expect(taskEventTypes(created.task.id)).toEqual(['created', 'claimed', 'started', 'human_override', 'cancelled']);
  });

  it('compat cancellation skips claimed iterate tasks', () => {
    const files = seedLineage();
    const pending = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      rootAssetId: files.rootId,
      targetAssetId: files.rootId,
      taskType: 'iterate',
    });
    const active = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: 'Keep this compatibility task claimed.',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'iterate',
    });
    claimLineageTask(defaultProject, {
      agentName: 'Iterate worker',
      taskId: active.task.id,
    });

    cancelLineageIterateTasksForAssets(defaultProject, {
      actor: 'human',
      confirmWrite: true,
      rootAssetId: files.rootId,
    });

    expect(listLineageTasks(defaultProject, files.rootId).tasks.map(task => [task.id, task.status])).toEqual([
      [active.task.id, 'claimed'],
    ]);
    expect(listLineageTasks(defaultProject, files.rootId, ['cancelled']).tasks.map(task => task.id)).toEqual([pending.task.id]);
  });

  it('resolves a pending task with generation and asset outputs', () => {
    const files = seedLineage();
    const created = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: 'Try a readable reroll.',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'reroll',
    });

    const resolved = resolveLineageTask(defaultProject, {
      actor: 'agent',
      confirmWrite: true,
      resolvedAssetId: files.alternateId,
      resolvedGenerationJobId: 'job-resolve-task',
      taskId: created.task.id,
    });

    expect(resolved.task).toMatchObject({
      id: created.task.id,
      resolved_asset_id: files.alternateId,
      resolved_generation_job_id: 'job-resolve-task',
      status: 'resolved',
    });
    expect(listLineageTasks(defaultProject, files.rootId).tasks).toEqual([]);
    expect(listLineageTasks(defaultProject, files.rootId, ['resolved']).tasks.map(task => task.id)).toEqual([created.task.id]);
    expect(taskEventTypes(created.task.id)).toEqual(['created', 'resolved']);
  });

  it('uses a stable task id format', () => {
    expect(taskIdFor('demo', 'root-1', 'target-9', 'reroll')).toBe('demo:root-1:lineage-task:reroll:target-9');
  });

  it('backfills current selections and pending reroll requests idempotently', () => {
    const files = seedLineage();
    updateSelectedAsset(defaultProject, {
      assetId: files.childId,
      confirmWrite: true,
      notes: 'Legacy selection note.',
      rootAssetId: files.rootId,
    });
    markLineageRerollRequest(defaultProject, {
      confirmWrite: true,
      nodeAssetId: files.childId,
      notes: 'Legacy reroll note.',
      requestedBy: 'agent',
      rootAssetId: files.rootId,
    });

    const database = lineageDb();
    try {
      database.prepare("delete from lineage_schema_migrations where key = 'lineage_tasks_backfilled_v1'").run();
      backfillLineageTasks(database);
      backfillLineageTasks(database);
      expect(database.prepare("select key from lineage_schema_migrations where key = 'lineage_tasks_backfilled_v1'").get()).toMatchObject({
        key: 'lineage_tasks_backfilled_v1',
      });
    } finally {
      database.close();
    }
    const first = listLineageTasks(defaultProject, files.rootId).tasks;
    const reopened = lineageDb();
    reopened.close();
    const second = listLineageTasks(defaultProject, files.rootId).tasks;

    expect(first.map(task => [task.task_type, task.instructions, task.created_by]).sort()).toEqual([
      ['iterate', 'Legacy selection note.', 'human'],
      ['reroll', 'Legacy reroll note.', 'agent'],
    ]);
    expect(second.map(task => task.id).sort()).toEqual(first.map(task => task.id).sort());
    expect(second).toHaveLength(2);
  });
});
