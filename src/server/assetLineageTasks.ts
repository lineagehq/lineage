import { randomBytes } from 'node:crypto';
import { createAgentClaim, recordAgentClaimWriteAllowed, releaseAgentClaim, revokeAgentClaimInDatabase, validateAgentClaimForWrite, type AgentClaim } from './agentClaims';
import { lineageDb, nowIso, type DatabaseSync } from './assetLineageDb';
import type {
  LineageTask,
  LineageTaskActor,
  LineageTaskEvent,
  LineageTaskMutationResponse,
  LineageTaskStatus,
  LineageTasksResponse,
  LineageTaskType,
} from '../shared/types';

class LineageTaskError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function isLineageTaskError(error: unknown): error is LineageTaskError {
  return error instanceof LineageTaskError;
}

type Row = Record<string, unknown>;
type LineageTaskMutationResult = Omit<LineageTaskMutationResponse, 'events'> & { project: string; events: LineageTaskEvent[] };
type LineageTaskClaimResult = LineageTaskMutationResult & { claim: AgentClaim; claim_token: string };

const activeStatuses: LineageTaskStatus[] = ['pending', 'claimed', 'in_progress'];
const taskTypes = new Set<LineageTaskType>(['iterate', 'reroll']);
const taskStatuses = new Set<LineageTaskStatus>(['pending', 'claimed', 'in_progress', 'resolved', 'cancelled']);

export function taskIdFor(project: string, rootAssetId: string, targetAssetId: string, taskType: LineageTaskType): string {
  return `${project}:${rootAssetId}:lineage-task:${taskType}:${targetAssetId}`;
}

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(6).toString('base64url').toLowerCase()}`;
}

function metadataJson(metadata?: Record<string, unknown>): string | null {
  return metadata ? JSON.stringify(metadata) : null;
}

function metadataWithoutClaim(metadata?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const next = { ...metadata };
  delete next.claim_id;
  return Object.keys(next).length > 0 ? next : undefined;
}

function parseMetadata(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function normalizeProject(project: string): string {
  const trimmed = project.trim();
  if (!trimmed) throw new LineageTaskError('Lineage task requires project');
  return trimmed;
}

function normalizeTaskType(taskType: LineageTaskType): LineageTaskType {
  if (!taskTypes.has(taskType)) throw new LineageTaskError(`Unsupported lineage task type: ${taskType}`);
  return taskType;
}

function normalizeStatus(status: LineageTaskStatus): LineageTaskStatus {
  if (!taskStatuses.has(status)) throw new LineageTaskError(`Unsupported lineage task status: ${status}`);
  return status;
}

function normalizeActor(actor: string, label: string): string {
  const trimmed = actor.trim();
  if (!trimmed) throw new LineageTaskError(`${label} is required`);
  return trimmed;
}

function requireAsset(database: DatabaseSync, project: string, assetId: string): void {
  const row = database.prepare('select id from assets where project_id = ? and id = ?').get(project, assetId);
  if (!row) throw new LineageTaskError(`Unknown indexed asset: ${assetId}`, 404);
}

function taskFromRow(row: Row): LineageTask {
  const metadata = parseMetadata(row.metadata_json);
  const claimId = typeof metadata?.claim_id === 'string' ? metadata.claim_id : undefined;
  const instructions = typeof row.instructions === 'string' ? row.instructions : undefined;
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    root_asset_id: String(row.root_asset_id),
    target_asset_id: String(row.target_asset_id),
    task_type: String(row.task_type) as LineageTaskType,
    status: String(row.status) as LineageTaskStatus,
    instructions,
    prompt_status: instructions?.trim() ? 'ready' : 'needs_prompt',
    created_by: String(row.created_by) as LineageTaskActor,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    claimed_at: typeof row.claimed_at === 'string' ? row.claimed_at : undefined,
    started_at: typeof row.started_at === 'string' ? row.started_at : undefined,
    resolved_at: typeof row.resolved_at === 'string' ? row.resolved_at : undefined,
    cancelled_at: typeof row.cancelled_at === 'string' ? row.cancelled_at : undefined,
    resolved_generation_job_id: typeof row.resolved_generation_job_id === 'string' ? row.resolved_generation_job_id : undefined,
    resolved_asset_id: typeof row.resolved_asset_id === 'string' ? row.resolved_asset_id : undefined,
    claimed_by_claim_id: claimId,
    metadata,
  };
}

function eventFromRow(row: Row): LineageTaskEvent {
  return {
    id: String(row.id),
    task_id: String(row.task_id),
    event_type: String(row.event_type) as LineageTaskEvent['event_type'],
    actor: typeof row.actor === 'string' ? row.actor : undefined,
    message: typeof row.message === 'string' ? row.message : undefined,
    created_at: String(row.created_at),
    metadata: parseMetadata(row.metadata_json),
  };
}

function findTask(database: DatabaseSync, project: string, taskId: string): LineageTask | null {
  const row = database.prepare('select * from lineage_tasks where project_id = ? and id = ?').get(project, taskId) as Row | undefined;
  return row ? taskFromRow(row) : null;
}

function requireTask(database: DatabaseSync, project: string, taskId: string): LineageTask {
  const task = findTask(database, project, taskId);
  if (!task) throw new LineageTaskError(`Unknown lineage task: ${taskId}`, 404);
  return task;
}

function requireTaskPrompt(task: LineageTask, action: 'claimed' | 'started'): void {
  if (task.prompt_status === 'needs_prompt') {
    throw new LineageTaskError(`Lineage task needs a variation prompt before it can be ${action}.`, 409);
  }
}

function taskEvents(database: DatabaseSync, taskId: string): LineageTaskEvent[] {
  const rows = database.prepare('select * from lineage_task_events where task_id = ? order by created_at, rowid').all(taskId) as Row[];
  return rows.map(eventFromRow);
}

function recordEvent(database: DatabaseSync, taskId: string, eventType: string, actor?: string, message?: string, metadata?: Record<string, unknown>): void {
  database.prepare(`
    insert into lineage_task_events (id, task_id, event_type, actor, message, created_at, metadata_json)
    values (?, ?, ?, ?, ?, ?, ?)
  `).run(randomId('lineage_task_event'), taskId, eventType, actor || null, message || null, nowIso(), metadataJson(metadata));
}

function taskWithEvents(database: DatabaseSync, project: string, taskId: string): LineageTaskMutationResult {
  return { project, ok: true, task: requireTask(database, project, taskId), events: taskEvents(database, taskId) };
}

function assertChanged(result: { changes: number | bigint }, message: string): void {
  if (Number(result.changes) !== 1) throw new LineageTaskError(message, 409);
}

function transaction<T>(database: DatabaseSync, callback: () => T): T {
  database.exec('BEGIN IMMEDIATE');
  try {
    const value = callback();
    database.exec('COMMIT');
    return value;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function taskReadWithEvents(database: DatabaseSync, project: string, taskId: string) {
  return { task: requireTask(database, project, taskId), events: taskEvents(database, taskId) };
}

export function listLineageTasks(project: string, rootAssetId: string, statuses: LineageTaskStatus[] = activeStatuses): LineageTasksResponse {
  const normalizedProject = normalizeProject(project);
  const normalizedStatuses = statuses.map(normalizeStatus);
  const database = lineageDb();
  try {
    requireAsset(database, normalizedProject, rootAssetId);
    if (normalizedStatuses.length === 0) {
      return { project: normalizedProject, root_asset_id: rootAssetId, tasks: [], fetchedAt: nowIso() };
    }
    const placeholders = normalizedStatuses.map(() => '?').join(',');
    const rows = database.prepare(`
      select * from lineage_tasks
      where project_id = ? and root_asset_id = ? and status in (${placeholders})
      order by updated_at desc, created_at desc, id
    `).all(normalizedProject, rootAssetId, ...normalizedStatuses) as Row[];
    return { project: normalizedProject, root_asset_id: rootAssetId, tasks: rows.map(taskFromRow), fetchedAt: nowIso() };
  } finally {
    database.close();
  }
}

export function getLineageTask(project: string, taskId: string) {
  const normalizedProject = normalizeProject(project);
  const database = lineageDb();
  try {
    return { project: normalizedProject, ...taskReadWithEvents(database, normalizedProject, taskId) };
  } finally {
    database.close();
  }
}

export function upsertLineageTask(project: string, fields: {
  createdBy: LineageTaskActor;
  instructions?: string | null;
  rootAssetId: string;
  targetAssetId: string;
  taskType: LineageTaskType;
}): LineageTaskMutationResult {
  const normalizedProject = normalizeProject(project);
  const taskType = normalizeTaskType(fields.taskType);
  const taskId = taskIdFor(normalizedProject, fields.rootAssetId, fields.targetAssetId, taskType);
  const database = lineageDb();
  try {
    requireAsset(database, normalizedProject, fields.rootAssetId);
    requireAsset(database, normalizedProject, fields.targetAssetId);
    const existing = database.prepare(`
      select * from lineage_tasks
      where project_id = ? and root_asset_id = ? and target_asset_id = ? and task_type = ?
        and status in ('pending', 'claimed', 'in_progress')
      order by created_at desc limit 1
    `).get(normalizedProject, fields.rootAssetId, fields.targetAssetId, taskType) as Row | undefined;
    const instructionsProvided = fields.instructions !== undefined;
    const instructions = fields.instructions?.trim() || undefined;
    if (existing) {
      const task = taskFromRow(existing);
      if (task.status !== 'pending' && instructionsProvided && instructions !== task.instructions) {
        throw new LineageTaskError('Only pending lineage tasks can update instructions.', 409);
      }
      if (task.status === 'pending' && instructionsProvided && instructions !== task.instructions) {
        const timestamp = nowIso();
        transaction(database, () => {
          const result = database.prepare(`
            update lineage_tasks
            set instructions = ?, updated_at = ?
            where id = ? and status = 'pending'
          `).run(instructions || null, timestamp, task.id);
          assertChanged(result, 'Only pending lineage tasks can update instructions.');
          recordEvent(database, task.id, 'instructions_updated', fields.createdBy, 'Instructions updated.');
        });
      }
      return taskWithEvents(database, normalizedProject, task.id);
    }
    const closedTask = findTask(database, normalizedProject, taskId);
    if (closedTask) {
      const timestamp = nowIso();
      transaction(database, () => {
        const result = database.prepare(`
          update lineage_tasks
          set status = 'pending', instructions = ?, created_by = ?, updated_at = ?,
            claimed_at = null, started_at = null, resolved_at = null, cancelled_at = null,
            resolved_generation_job_id = null, resolved_asset_id = null, metadata_json = null
          where id = ? and status not in ('pending', 'claimed', 'in_progress')
        `).run(instructions || null, fields.createdBy, timestamp, taskId);
        assertChanged(result, 'Lineage task changed while reopening.');
        recordEvent(database, taskId, 'created', fields.createdBy, 'Lineage task created.');
      });
      return taskWithEvents(database, normalizedProject, taskId);
    }
    const timestamp = nowIso();
    transaction(database, () => {
      database.prepare(`
        insert into lineage_tasks (
          id, project_id, root_asset_id, target_asset_id, task_type, status, instructions,
          created_by, created_at, updated_at, metadata_json
        ) values (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, null)
      `).run(taskId, normalizedProject, fields.rootAssetId, fields.targetAssetId, taskType, instructions || null, fields.createdBy, timestamp, timestamp);
      recordEvent(database, taskId, 'created', fields.createdBy, 'Lineage task created.');
    });
    return taskWithEvents(database, normalizedProject, taskId);
  } finally {
    database.close();
  }
}

export function updateLineageTaskInstructions(project: string, fields: { taskId: string; instructions: string }): LineageTaskMutationResult {
  const normalizedProject = normalizeProject(project);
  const instructions = fields.instructions.trim();
  const database = lineageDb();
  try {
    const task = requireTask(database, normalizedProject, fields.taskId);
    if (task.status !== 'pending') throw new LineageTaskError('Only pending lineage tasks can update instructions.', 409);
    const timestamp = nowIso();
    transaction(database, () => {
      const result = database.prepare(`
        update lineage_tasks
        set instructions = ?, updated_at = ?
        where id = ? and status = 'pending'
      `).run(instructions || null, timestamp, task.id);
      assertChanged(result, 'Only pending lineage tasks can update instructions.');
      if (task.task_type === 'iterate') {
        database.prepare(`
          update asset_selections set notes = ?
          where project_id = ? and root_asset_id = ? and asset_id = ?
        `).run(instructions || null, normalizedProject, task.root_asset_id, task.target_asset_id);
      } else if (task.task_type === 'reroll') {
        database.prepare(`
          update asset_reroll_requests set notes = ?
          where project_id = ? and root_asset_id = ? and node_asset_id = ? and status = 'pending'
        `).run(instructions || null, normalizedProject, task.root_asset_id, task.target_asset_id);
      }
      recordEvent(database, task.id, 'instructions_updated', 'human', 'Instructions updated.');
    });
    return taskWithEvents(database, normalizedProject, task.id);
  } finally {
    database.close();
  }
}

export function addLineageTaskComment(project: string, fields: { taskId: string; actor: string; message: string }): LineageTaskMutationResult {
  const normalizedProject = normalizeProject(project);
  const actor = normalizeActor(fields.actor, 'Comment actor');
  const message = fields.message.trim();
  if (!message) throw new LineageTaskError('Comment message is required');
  const database = lineageDb();
  try {
    const task = requireTask(database, normalizedProject, fields.taskId);
    transaction(database, () => {
      recordEvent(database, task.id, 'comment_added', actor, message);
    });
    return taskWithEvents(database, normalizedProject, task.id);
  } finally {
    database.close();
  }
}

export function claimLineageTask(project: string, fields: { taskId: string; agentName: string }): LineageTaskClaimResult {
  const normalizedProject = normalizeProject(project);
  const agentName = normalizeActor(fields.agentName, 'Agent name');
  const beforeClaimDb = lineageDb();
  try {
    const task = requireTask(beforeClaimDb, normalizedProject, fields.taskId);
    if (task.status !== 'pending') throw new LineageTaskError('Only pending lineage tasks can be claimed.', 409);
    requireTaskPrompt(task, 'claimed');
  } finally {
    beforeClaimDb.close();
  }

  const claimResult = createAgentClaim({
    agentName,
    project: normalizedProject,
    scopeType: 'lineage_task',
    targetId: fields.taskId,
    targetTitle: fields.taskId,
  });
  if (!claimResult.claim) throw new LineageTaskError('Unable to create lineage task claim.', 500);
  const claim = claimResult.claim;

  const database = lineageDb();
  try {
    const task = requireTask(database, normalizedProject, fields.taskId);
    if (task.status !== 'pending') {
      releaseAgentClaim(claimResult.claim_token);
      throw new LineageTaskError('Only pending lineage tasks can be claimed.', 409);
    }
    try {
      requireTaskPrompt(task, 'claimed');
    } catch (error) {
      releaseAgentClaim(claimResult.claim_token);
      throw error;
    }
    const timestamp = nowIso();
    const metadata = { ...(task.metadata || {}), claim_id: claim.id };
    try {
      transaction(database, () => {
        const result = database.prepare(`
          update lineage_tasks
          set status = 'claimed', claimed_at = ?, updated_at = ?, metadata_json = ?
          where id = ? and status = 'pending'
        `).run(timestamp, timestamp, metadataJson(metadata), task.id);
        assertChanged(result, 'Only pending lineage tasks can be claimed.');
        recordEvent(database, task.id, 'claimed', agentName, 'Lineage task claimed.', { claim_id: claim.id });
      });
    } catch (error) {
      releaseAgentClaim(claimResult.claim_token);
      throw error;
    }
    return {
      ...taskWithEvents(database, normalizedProject, task.id),
      claim,
      claim_token: claimResult.claim_token,
    };
  } finally {
    database.close();
  }
}

export function startLineageTask(project: string, fields: { taskId: string; claimToken: string }): LineageTaskMutationResult {
  const normalizedProject = normalizeProject(project);
  const precheckDatabase = lineageDb();
  try {
    const task = requireTask(precheckDatabase, normalizedProject, fields.taskId);
    if (task.status !== 'claimed') throw new LineageTaskError('Only claimed lineage tasks can be started.', 409);
    requireTaskPrompt(task, 'started');
  } finally {
    precheckDatabase.close();
  }
  const validation = validateAgentClaimForWrite({
    claimToken: fields.claimToken,
    dangerLevel: 'enforce',
    project: normalizedProject,
    recordEvent: false,
    scopeType: 'lineage_task',
    targetId: fields.taskId,
    writeKind: 'lineage_task_start',
  });
  if (!validation.ok) throw new LineageTaskError(validation.message, 409);
  const database = lineageDb();
  try {
    const task = requireTask(database, normalizedProject, fields.taskId);
    if (task.status !== 'claimed') throw new LineageTaskError('Only claimed lineage tasks can be started.', 409);
    requireTaskPrompt(task, 'started');
    if (task.claimed_by_claim_id && task.claimed_by_claim_id !== validation.claim.id) {
      throw new LineageTaskError('Claim token does not match the task claim.', 409);
    }
    const timestamp = nowIso();
    const metadata = { ...(task.metadata || {}), claim_id: validation.claim.id };
    transaction(database, () => {
      const result = database.prepare(`
        update lineage_tasks
        set status = 'in_progress', started_at = ?, updated_at = ?, metadata_json = ?
        where id = ? and status = 'claimed'
      `).run(timestamp, timestamp, metadataJson(metadata), task.id);
      assertChanged(result, 'Only claimed lineage tasks can be started.');
      recordEvent(database, task.id, 'started', validation.claim.agent_name, 'Lineage task started.', { claim_id: validation.claim.id });
    });
    recordAgentClaimWriteAllowed(validation.claim, {
      dangerLevel: 'enforce',
      targetId: fields.taskId,
      writeKind: 'lineage_task_start',
    });
    return taskWithEvents(database, normalizedProject, task.id);
  } finally {
    database.close();
  }
}

export function overrideLineageTask(project: string, fields: {
  actor: string;
  instructions?: string;
  reason: string;
  taskId: string;
}): LineageTaskMutationResult {
  const normalizedProject = normalizeProject(project);
  const actor = normalizeActor(fields.actor, 'Override actor');
  const reason = fields.reason.trim();
  if (!reason) throw new LineageTaskError('Override reason is required');
  const database = lineageDb();
  try {
    const task = requireTask(database, normalizedProject, fields.taskId);
    if (!['claimed', 'in_progress'].includes(task.status)) {
      throw new LineageTaskError(`Only claimed or in-progress lineage tasks can be overridden; task is ${task.status}.`, 409);
    }
    const timestamp = nowIso();
    const instructions = fields.instructions === undefined ? task.instructions : (fields.instructions.trim() || undefined);
    const metadata = metadataWithoutClaim(task.metadata);
    transaction(database, () => {
      const result = database.prepare(`
        update lineage_tasks
        set status = 'pending', instructions = ?, claimed_at = null, started_at = null,
          updated_at = ?, metadata_json = ?
        where project_id = ? and id = ? and status in ('claimed', 'in_progress')
      `).run(instructions || null, timestamp, metadataJson(metadata), normalizedProject, task.id);
      assertChanged(result, `Only active lineage task ${task.id} could be overridden.`);
      if (task.claimed_by_claim_id) {
        revokeAgentClaimInDatabase(database, normalizedProject, task.claimed_by_claim_id, {
          actor,
          reason,
        });
      }
      recordEvent(database, task.id, 'human_override', actor, reason, {
        previous_claim_id: task.claimed_by_claim_id,
        previous_status: task.status,
      });
    });
    return taskWithEvents(database, normalizedProject, task.id);
  } finally {
    database.close();
  }
}

export function cancelLineageTask(project: string, fields: { taskId: string; actor: string; confirmWrite: boolean; override?: boolean }): LineageTaskMutationResult {
  const normalizedProject = normalizeProject(project);
  const actor = normalizeActor(fields.actor, 'Cancel actor');
  const database = lineageDb();
  try {
    const task = requireTask(database, normalizedProject, fields.taskId);
    if (task.status === 'cancelled') return { project: normalizedProject, ok: true, task, events: taskEvents(database, task.id) };
    if (!['pending', 'claimed', 'in_progress'].includes(task.status)) {
      throw new LineageTaskError(`Only open lineage tasks can be cancelled; task is ${task.status}.`, 409);
    }
    if (task.status !== 'pending' && !fields.override) {
      throw new LineageTaskError('Cancelling an active lineage task requires override=true.', 409);
    }
    const overridingActiveTask = fields.override === true && task.status !== 'pending';
    const metadata = overridingActiveTask ? metadataWithoutClaim(task.metadata) : task.metadata;
    const timestamp = nowIso();
    const cancelledTask = {
      ...task,
      cancelled_at: timestamp,
      claimed_at: overridingActiveTask ? undefined : task.claimed_at,
      claimed_by_claim_id: overridingActiveTask ? undefined : task.claimed_by_claim_id,
      started_at: overridingActiveTask ? undefined : task.started_at,
      status: 'cancelled' as const,
      updated_at: timestamp,
      metadata,
    };
    if (!fields.confirmWrite) return { project: normalizedProject, ok: true, dryRun: true as const, task: cancelledTask, events: taskEvents(database, task.id) };
    transaction(database, () => {
      const result = database.prepare(`
        update lineage_tasks
        set status = 'cancelled', cancelled_at = ?, claimed_at = ?, started_at = ?,
          updated_at = ?, metadata_json = ?
        where id = ? and status = ?
      `).run(
        timestamp,
        overridingActiveTask ? null : task.claimed_at || null,
        overridingActiveTask ? null : task.started_at || null,
        timestamp,
        metadataJson(metadata),
        task.id,
        task.status
      );
      assertChanged(result, `Only ${task.status} lineage task ${task.id} could be cancelled.`);
      if (overridingActiveTask) {
        if (task.claimed_by_claim_id) {
          revokeAgentClaimInDatabase(database, normalizedProject, task.claimed_by_claim_id, {
            actor,
            reason: 'Lineage task cancelled by human override.',
          });
        }
        recordEvent(database, task.id, 'human_override', actor, 'Lineage task cancelled by human override.', {
          previous_claim_id: task.claimed_by_claim_id,
          previous_status: task.status,
        });
      }
      recordEvent(database, task.id, 'cancelled', actor, 'Lineage task cancelled.');
    });
    return taskWithEvents(database, normalizedProject, task.id);
  } finally {
    database.close();
  }
}

export function cancelLineageIterateTasksForAssets(project: string, fields: {
  actor: string;
  assetIds?: string[];
  confirmWrite: boolean;
  rootAssetId: string;
}): LineageTaskMutationResult[] {
  const targetIds = fields.assetIds ? new Set(fields.assetIds) : undefined;
  return listLineageTasks(project, fields.rootAssetId, ['pending']).tasks
    .filter(task => task.task_type === 'iterate')
    .filter(task => !targetIds || targetIds.has(task.target_asset_id))
    .map(task => cancelLineageTask(project, {
      actor: fields.actor,
      confirmWrite: fields.confirmWrite,
      taskId: task.id,
    }));
}

export function cancelPendingLineageIterateTasksInTransaction(
  database: DatabaseSync,
  project: string,
  rootAssetId: string,
  actor = 'system',
): void {
  const rows = database.prepare(`
    select * from lineage_tasks
    where project_id = ? and root_asset_id = ? and task_type = 'iterate' and status = 'pending'
    order by created_at
  `).all(project, rootAssetId) as Row[];
  for (const row of rows) {
    const task = taskFromRow(row);
    const timestamp = nowIso();
    const result = database.prepare(`
      update lineage_tasks
      set status = 'cancelled', cancelled_at = ?, updated_at = ?
      where id = ? and status = 'pending'
    `).run(timestamp, timestamp, task.id);
    assertChanged(result, `Only pending lineage task ${task.id} could be cancelled.`);
    recordEvent(database, task.id, 'cancelled', actor, 'Lineage task cancelled.');
  }
}

export function resolvePendingLineageRerollTaskInTransaction(database: DatabaseSync, project: string, fields: {
  actor: string;
  resolvedAssetId: string;
  resolvedGenerationJobId: string;
  rootAssetId: string;
  targetAssetId: string;
}): void {
  const row = database.prepare(`
    select * from lineage_tasks
    where project_id = ? and root_asset_id = ? and target_asset_id = ? and task_type = 'reroll'
      and status in ('pending', 'claimed', 'in_progress')
    order by created_at desc limit 1
  `).get(project, fields.rootAssetId, fields.targetAssetId) as Row | undefined;
  if (!row) return;
  const task = taskFromRow(row);
  const timestamp = nowIso();
  const result = database.prepare(`
    update lineage_tasks
    set status = 'resolved', resolved_at = ?, resolved_generation_job_id = ?,
      resolved_asset_id = ?, updated_at = ?
    where id = ? and status = ?
  `).run(
    timestamp,
    fields.resolvedGenerationJobId,
    fields.resolvedAssetId,
    timestamp,
    task.id,
    task.status,
  );
  assertChanged(result, `Only ${task.status} lineage task ${task.id} could be resolved.`);
  recordEvent(database, task.id, 'resolved', fields.actor, 'Lineage task resolved.', {
    resolved_asset_id: fields.resolvedAssetId,
    resolved_generation_job_id: fields.resolvedGenerationJobId,
  });
}

export function resolveLineageTask(project: string, fields: {
  actor: string;
  confirmWrite: boolean;
  resolvedAssetId?: string;
  resolvedGenerationJobId?: string;
  taskId: string;
}): LineageTaskMutationResult {
  const normalizedProject = normalizeProject(project);
  const actor = normalizeActor(fields.actor, 'Resolve actor');
  const database = lineageDb();
  try {
    const task = requireTask(database, normalizedProject, fields.taskId);
    if (fields.resolvedAssetId) requireAsset(database, normalizedProject, fields.resolvedAssetId);
    if (task.status === 'resolved') return { project: normalizedProject, ok: true, task, events: taskEvents(database, task.id) };
    if (!['pending', 'claimed', 'in_progress'].includes(task.status)) {
      throw new LineageTaskError(`Only open lineage tasks can be resolved; task is ${task.status}.`, 409);
    }
    const timestamp = nowIso();
    const resolvedTask = {
      ...task,
      status: 'resolved' as const,
      resolved_asset_id: fields.resolvedAssetId,
      resolved_at: timestamp,
      resolved_generation_job_id: fields.resolvedGenerationJobId,
      updated_at: timestamp,
    };
    if (!fields.confirmWrite) return { project: normalizedProject, ok: true, dryRun: true as const, task: resolvedTask, events: taskEvents(database, task.id) };
    transaction(database, () => {
      const result = database.prepare(`
        update lineage_tasks
        set status = 'resolved', resolved_at = ?, resolved_generation_job_id = ?, resolved_asset_id = ?, updated_at = ?
        where id = ? and status = ?
      `).run(timestamp, fields.resolvedGenerationJobId || null, fields.resolvedAssetId || null, timestamp, task.id, task.status);
      assertChanged(result, `Only ${task.status} lineage task ${task.id} could be resolved.`);
      recordEvent(database, task.id, 'resolved', actor, 'Lineage task resolved.', {
        resolved_asset_id: fields.resolvedAssetId,
        resolved_generation_job_id: fields.resolvedGenerationJobId,
      });
    });
    return taskWithEvents(database, normalizedProject, task.id);
  } finally {
    database.close();
  }
}
