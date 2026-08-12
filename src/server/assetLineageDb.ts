import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { packageRoot } from './assetCore';
import { assertProfileWriterLeaseHeld, assertSelectedProfileDatabaseIdentity } from './profileWriterLease';
import { loadNodeSqlite } from './nodeSqlite';

export type DatabaseSync = DatabaseSyncType;

export function nowIso(): string {
  return new Date().toISOString();
}

export function lineageDbPath(): string {
  return process.env.LINEAGE_DB || join(packageRoot, '.lineage', 'asset-lineage.sqlite');
}

export function lineageDb(): DatabaseSync {
  const readOnly = process.env.LINEAGE_DB_ACCESS === 'read-only';
  if (!readOnly) assertProfileWriterLeaseHeld();
  if (!readOnly && !existsSync(lineageDbPath())) {
    throw new Error(`Refusing writable open of missing profile database ${lineageDbPath()}; bind an existing database or create a non-production clone first`);
  }
  if (!readOnly) mkdirSync(join(lineageDbPath(), '..'), { recursive: true });
  const { DatabaseSync } = loadNodeSqlite();
  const database = readOnly ? new DatabaseSync(lineageDbPath(), { readOnly: true }) : new DatabaseSync(lineageDbPath());
  if (process.env.LINEAGE_PROFILE) assertSelectedProfileDatabaseIdentity(database);
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA busy_timeout = 5000');
  if (readOnly) return database;
  database.exec('PRAGMA journal_mode = WAL');
  database.exec(`
    create table if not exists projects (
      id text primary key,
      product text not null,
      catalog_path text,
      created_at text not null,
      updated_at text not null
    );
    create table if not exists assets (
      id text primary key,
      project_id text not null references projects(id),
      source text not null check (source in ('local', 'catalog')),
      local_path text,
      s3_key text,
      checksum_sha256 text,
      media_type text not null,
      title text not null,
      status text not null,
      channel text,
      campaign text,
      audience text,
      size_bytes integer,
      content_type text,
      created_at text not null,
      updated_at text not null,
      last_seen_at text not null
    );
    create index if not exists assets_project_source_seen on assets(project_id, source, last_seen_at);
    create index if not exists assets_project_checksum on assets(project_id, checksum_sha256);
    create index if not exists assets_project_channel_campaign on assets(project_id, channel, campaign);
    create table if not exists lineage_schema_migrations (
      key text primary key,
      applied_at text not null
    );
    create table if not exists asset_edges (
      id text primary key,
      project_id text not null references projects(id),
      parent_asset_id text not null references assets(id),
      child_asset_id text not null references assets(id),
      relation_type text not null check (relation_type in ('derived_from')),
      created_at text not null,
      summary text,
      summary_created_by text check (summary_created_by in ('human', 'agent', 'system')),
      summary_updated_by text check (summary_updated_by in ('human', 'agent', 'system')),
      summary_updated_at text,
      unique (project_id, parent_asset_id, child_asset_id, relation_type)
    );
    create index if not exists edges_parent on asset_edges(project_id, parent_asset_id);
    create index if not exists edges_child on asset_edges(project_id, child_asset_id);
    create table if not exists asset_attempts (
      id text primary key,
      project_id text not null references projects(id),
      node_asset_id text not null references assets(id),
      asset_id text not null references assets(id),
      attempt_index integer not null check (attempt_index > 0),
      source text not null check (source in ('initial', 'generated_child', 'reroll')),
      prompt text,
      generation_job_id text,
      file_path text,
      checksum_sha256 text,
      created_at text not null,
      promoted_at text,
      is_current integer not null check (is_current in (0, 1)),
      unique(project_id, node_asset_id, attempt_index),
      unique(project_id, node_asset_id, asset_id, source)
    );
    create unique index if not exists asset_attempts_one_current
      on asset_attempts(project_id, node_asset_id)
      where is_current = 1;
    create index if not exists asset_attempts_node_created
      on asset_attempts(project_id, node_asset_id, created_at);
    create table if not exists asset_reroll_requests (
      id text primary key,
      project_id text not null references projects(id),
      root_asset_id text not null references assets(id),
      node_asset_id text not null references assets(id),
      status text not null check (status in ('pending', 'resolved', 'cancelled')),
      requested_by text not null check (requested_by in ('human', 'agent', 'system')),
      notes text,
      created_at text not null,
      resolved_at text
    );
    create unique index if not exists asset_reroll_requests_one_pending
      on asset_reroll_requests(project_id, root_asset_id, node_asset_id)
      where status = 'pending';
    create index if not exists asset_reroll_requests_root_status
      on asset_reroll_requests(project_id, root_asset_id, status, created_at);
    create table if not exists asset_social_marks (
      id text primary key,
      project_id text not null references projects(id),
      root_asset_id text not null references assets(id),
      asset_id text not null references assets(id),
      notes text,
      marked_by text not null,
      marked_at text not null,
      unmarked_by text,
      unmarked_at text,
      updated_at text not null,
      unique(project_id, root_asset_id, asset_id)
    );
    create index if not exists asset_social_marks_root_active
      on asset_social_marks(project_id, root_asset_id, unmarked_at, marked_at);
    create table if not exists asset_reviews (
      asset_id text primary key references assets(id),
      review_state text not null check (review_state in ('unreviewed', 'approved', 'needs_revision', 'rejected', 'ignored')),
      reviewed_at text,
      ignored_at text,
      notes text,
      updated_at text not null
    );
    create table if not exists asset_selections (
      id text primary key,
      project_id text not null references projects(id),
      root_asset_id text not null references assets(id),
      asset_id text not null references assets(id),
      notes text,
      selected_at text not null,
      unique(project_id, root_asset_id)
    );
    create table if not exists asset_layouts (
      id text primary key,
      project_id text not null references projects(id),
      root_asset_id text not null references assets(id),
      asset_id text not null references assets(id),
      x real not null,
      y real not null,
      updated_at text not null,
      unique(project_id, root_asset_id, asset_id)
    );
    create table if not exists lineage_workspaces (
      id text primary key,
      project_id text not null references projects(id),
      root_asset_id text not null references assets(id),
      title text not null,
      status text not null check (status in ('active', 'paused', 'archived')),
      notes text,
      created_by text not null check (created_by in ('human', 'agent', 'system')),
      active_at text,
      created_at text not null,
      updated_at text not null,
      unique(project_id, root_asset_id)
    );
    create index if not exists lineage_workspaces_project_status on lineage_workspaces(project_id, status, updated_at);
    create index if not exists lineage_workspaces_project_active on lineage_workspaces(project_id, active_at);
    create table if not exists asset_ledger_records (
      id text primary key,
      project_id text not null references projects(id),
      canonical_asset_id text not null,
      checksum_sha256 text,
      media_type text not null,
      title text not null,
      status text not null,
      channel text,
      campaign text,
      audience text,
      created_at text not null,
      updated_at text not null,
      first_seen_at text not null default (datetime('now')),
      last_seen_at text not null
    );
    create index if not exists asset_ledger_records_project_seen on asset_ledger_records(project_id, last_seen_at);
    create index if not exists asset_ledger_records_project_checksum on asset_ledger_records(project_id, checksum_sha256);
    create table if not exists asset_ledger_sources (
      id text primary key,
      project_id text not null references projects(id),
      record_id text not null references asset_ledger_records(id) on delete cascade,
      source_type text not null check (source_type in ('local', 'catalog', 's3')),
      asset_id text,
      local_path text,
      s3_bucket text,
      s3_region text,
      s3_key text,
      s3_version_id text,
      etag text,
      size_bytes integer,
      content_type text,
      updated_at text,
      first_seen_at text not null default (datetime('now')),
      last_seen_at text not null
    );
    create index if not exists asset_ledger_sources_project_type on asset_ledger_sources(project_id, source_type);
    create index if not exists asset_ledger_sources_record on asset_ledger_sources(project_id, record_id);
    create index if not exists asset_ledger_sources_s3_key on asset_ledger_sources(project_id, s3_key);
    create table if not exists asset_ledger_placements (
      id text primary key,
      project_id text not null references projects(id),
      asset_id text not null,
      channel text not null,
      status text not null,
      scheduled_at text,
      posted_at text,
      url text,
      notes text,
      updated_at text not null,
      synced_at text not null,
      unique(project_id, asset_id, channel)
    );
    create index if not exists asset_ledger_placements_project_status on asset_ledger_placements(project_id, status);
    create index if not exists asset_ledger_placements_asset on asset_ledger_placements(project_id, asset_id);
    create table if not exists asset_ledger_index_runs (
      id text primary key,
      project_id text not null references projects(id),
      source_mode text not null check (source_mode in ('all', 'catalog', 'local')),
      include_live_s3 integer not null default 0,
      status text not null check (status in ('running', 'complete', 'failed')),
      started_at text not null,
      completed_at text,
      assets_indexed integer not null default 0,
      records_after integer not null default 0,
      catalog_sources_after integer not null default 0,
      local_sources_after integer not null default 0,
      s3_sources_after integer not null default 0,
      error text
    );
    create index if not exists asset_ledger_index_runs_project_started on asset_ledger_index_runs(project_id, started_at);
    create table if not exists content_batches (
      id text not null,
      project_id text not null references projects(id),
      title text not null,
      campaign text,
      channel text,
      status text not null check (status in ('active', 'archived')),
      notes text,
      created_at text not null,
      updated_at text not null,
      primary key(project_id, id)
    );
    create index if not exists content_batches_project_updated on content_batches(project_id, updated_at);
    create table if not exists content_posts (
      id text not null,
      project_id text not null references projects(id),
      batch_id text not null,
      channel text not null,
      title text not null,
      phase text not null check (phase in ('draft', 'review', 'scheduled', 'posted', 'skipped', 'archived')),
      campaign text,
      body text,
      cta text,
      scheduled_at text,
      posted_at text,
      url text,
      notes text,
      source_path text,
      created_at text not null,
      updated_at text not null,
      primary key(project_id, id),
      foreign key(project_id, batch_id) references content_batches(project_id, id) on delete cascade
    );
    create index if not exists content_posts_project_phase on content_posts(project_id, phase);
    create index if not exists content_posts_batch on content_posts(project_id, batch_id);
    create table if not exists content_post_assets (
      id text primary key,
      project_id text not null references projects(id),
      post_id text not null,
      asset_id text not null,
      role text not null,
      notes text,
      attached_at text not null,
      unique(project_id, post_id, asset_id, role),
      foreign key(project_id, post_id) references content_posts(project_id, id) on delete cascade
    );
    create index if not exists content_post_assets_post on content_post_assets(project_id, post_id);
    create index if not exists content_post_assets_asset on content_post_assets(project_id, asset_id);
    create table if not exists content_targets (
      project_id text primary key references projects(id),
      post_id text not null,
      notes text,
      selected_at text not null,
      updated_at text not null,
      foreign key(project_id, post_id) references content_posts(project_id, id) on delete cascade
    );
    create table if not exists selection_sets (
      id text primary key,
      project_id text not null references projects(id),
      kind text not null check (kind in ('current', 'review')),
      key text not null,
      label text not null,
      status text not null check (status in ('active', 'archived')),
      created_by text not null check (created_by in ('human', 'agent', 'system')),
      created_at text not null,
      updated_at text not null,
      unique(project_id, kind, key)
    );
    create index if not exists selection_sets_project_kind on selection_sets(project_id, kind, updated_at);
    create table if not exists selection_items (
      id text primary key,
      set_id text not null references selection_sets(id) on delete cascade,
      asset_id text not null,
      role text not null check (role in ('primary', 'candidate', 'next_base')),
      variation_label text,
      position integer not null default 0,
      selected_by text check (selected_by in ('human', 'agent', 'system')),
      selected_at text,
      deselected_at text,
      notes text,
      created_at text not null,
      updated_at text not null,
      unique(set_id, asset_id)
    );
    create index if not exists selection_items_set_position on selection_items(set_id, position);
    create unique index if not exists selection_items_set_label on selection_items(set_id, variation_label) where variation_label is not null;
    create table if not exists generation_jobs (
      id text primary key,
      project_id text not null references projects(id),
      provider text not null default 'codex-handoff',
      adapter_version text not null,
      source_mode text not null check (source_mode in ('lineage_selection', 'lineage_reroll')),
      root_asset_id text not null references assets(id),
      prompt text not null,
      expected_output_count integer not null check (expected_output_count > 0),
      status text not null check (status in ('planned', 'imported', 'failed', 'cancelled')),
      output_dir text,
      handoff_json text,
      created_at text not null,
      updated_at text not null,
      imported_at text
    );
    create index if not exists generation_jobs_project_created on generation_jobs(project_id, created_at);
    create table if not exists generation_job_inputs (
      id text primary key,
      job_id text not null references generation_jobs(id) on delete cascade,
      project_id text not null references projects(id),
      asset_id text not null references assets(id),
      root_asset_id text not null references assets(id),
      role text not null check (role in ('lineage_next_base', 'reference', 'reroll_target')),
      position integer not null,
      selection_strategy text not null,
      selection_snapshot_json text not null,
      unique(job_id, asset_id, role)
    );
    create index if not exists generation_job_inputs_job on generation_job_inputs(job_id, position);
    create table if not exists generation_job_outputs (
      id text primary key,
      job_id text not null references generation_jobs(id) on delete cascade,
      project_id text not null references projects(id),
      output_index integer not null,
      file_path text not null,
      checksum_sha256 text not null,
      size_bytes integer not null,
      content_type text not null,
      imported_asset_id text not null references assets(id),
      parent_asset_id text not null references assets(id),
      imported_at text not null,
      edge_summary text,
      unique(job_id, output_index),
      unique(job_id, file_path)
    );
    create index if not exists generation_job_outputs_job on generation_job_outputs(job_id, output_index);
    create table if not exists generation_job_receipts (
      id text primary key,
      job_id text not null references generation_jobs(id) on delete cascade,
      receipt_type text not null check (receipt_type in ('plan', 'import', 'error')),
      status text not null check (status in ('ok', 'error')),
      command text not null,
      payload_json text not null,
      created_at text not null
    );
    create index if not exists generation_job_receipts_job on generation_job_receipts(job_id, created_at);
    create table if not exists generation_target_maps (
      job_id text primary key references generation_jobs(id) on delete cascade,
      schema_version text not null check (schema_version = 'lineage.generation_target_map.v1'),
      canonical_json text not null,
      digest_sha256 text not null,
      unique(job_id, digest_sha256)
    );
    create table if not exists generation_target_groups (
      id text primary key,
      job_id text not null references generation_jobs(id) on delete cascade,
      parent_asset_id text not null references assets(id),
      media_kind text check (media_kind is null or media_kind = 'static_image'),
      width integer,
      height integer,
      geometry_json text,
      delivery_surfaces_json text not null,
      grouping_mode text not null check (grouping_mode in ('consolidated', 'explicit_split')),
      variant_count integer not null check (variant_count > 0),
      target_map_digest text not null,
      guidance_json text not null,
      unlocked integer not null check (unlocked in (0, 1)),
      check (
        (unlocked = 1 and media_kind is null and width is null and height is null and geometry_json is null)
        or
        (unlocked = 0 and media_kind = 'static_image' and width is not null and height is not null and geometry_json is not null)
      )
    );
    create index if not exists generation_target_groups_job on generation_target_groups(job_id, id);
    create table if not exists generation_output_slots (
      id text primary key,
      job_id text not null references generation_jobs(id) on delete cascade,
      target_group_id text not null references generation_target_groups(id) on delete cascade,
      parent_asset_id text not null references assets(id),
      output_index integer not null check (output_index >= 0),
      variant_index integer not null check (variant_index >= 0),
      output_spec_json text,
      unique(job_id, output_index),
      unique(target_group_id, variant_index)
    );
    create index if not exists generation_output_slots_job on generation_output_slots(job_id, output_index);
    create table if not exists asset_output_specs (
      asset_id text primary key references assets(id),
      generation_job_id text not null references generation_jobs(id),
      output_index integer not null check (output_index >= 0),
      target_group_id text not null references generation_target_groups(id),
      variant_index integer not null check (variant_index >= 0),
      output_spec_json text not null,
      output_spec_digest text not null,
      actual_width integer not null check (actual_width > 0),
      actual_height integer not null check (actual_height > 0),
      created_at text not null,
      unique(generation_job_id, output_index)
    );
    create index if not exists asset_output_specs_job on asset_output_specs(generation_job_id, output_index);
    create table if not exists generation_target_defaults (
      project_id text not null references projects(id),
      root_asset_id text not null references assets(id),
      default_variant_count integer not null check (default_variant_count > 0),
      targets_json text not null,
      separate_surface_ids_json text not null,
      provenance text not null check (provenance = 'human'),
      created_at text not null,
      updated_at text not null,
      primary key(project_id, root_asset_id)
    );
    create table if not exists node_next_output_target_settings (
      project_id text not null references projects(id),
      root_asset_id text not null references assets(id),
      node_asset_id text not null references assets(id),
      schema_version text not null check (schema_version = 'lineage.node_next_output_targets.v1'),
      revision integer not null check (revision > 0),
      targets_json text not null,
      resolved_targets_json text not null,
      provenance_actor text not null check (provenance_actor in ('human', 'agent', 'system')),
      provenance_origin text not null check (provenance_origin in ('canvas', 'cli', 'derived_child')),
      digest_sha256 text not null,
      created_at text not null,
      updated_at text not null,
      primary key(project_id, root_asset_id, node_asset_id)
    );
    create index if not exists node_next_output_target_settings_node
      on node_next_output_target_settings(project_id, node_asset_id);
    create table if not exists generation_job_target_resolutions (
      job_id text not null references generation_jobs(id) on delete cascade,
      parent_asset_id text not null references assets(id),
      origin text not null check (origin in ('node_override', 'derived_child', 'canvas_default')),
      setting_revision integer,
      setting_digest_sha256 text,
      canvas_default_digest_sha256 text,
      resolution_digest_sha256 text not null,
      targets_json text not null,
      resolved_targets_json text not null,
      primary key(job_id, parent_asset_id)
    );
    create index if not exists generation_job_target_resolutions_job
      on generation_job_target_resolutions(job_id, parent_asset_id);
    create table if not exists adapter_settings (project_id text not null references projects(id), adapter_type text not null check (adapter_type in ('cloud', 'scheduler', 'image_generator')), provider text not null, enabled integer not null check (enabled in (0, 1)), secret_ref text, safe_config_json text not null, created_at text not null, updated_at text not null, primary key(project_id, adapter_type, provider)); create index if not exists adapter_settings_project_type on adapter_settings(project_id, adapter_type);
    create table if not exists buffer_connections (
      project_id text primary key references projects(id),
      organization_id text not null,
      credential_ref text not null,
      cli_version text not null,
      schema_fingerprint text not null,
      connection_fingerprint text not null,
      health_state text not null check (health_state in ('connected', 'credential_missing', 'organization_mismatch')),
      channel_synced_at text,
      created_at text not null,
      updated_at text not null
    );
    create table if not exists buffer_channels (
      project_id text not null references projects(id),
      channel_id text not null,
      organization_id text not null,
      service text not null,
      service_id text,
      display_name text not null,
      avatar_ref text,
      timezone text,
      posting_schedule_json text not null,
      allowed_actions_json text not null,
      capability_json text not null,
      disconnected integer not null check (disconnected in (0, 1)),
      locked integer not null check (locked in (0, 1)),
      paused integer not null check (paused in (0, 1)),
      available integer not null check (available in (0, 1)),
      capability_registry_version integer not null,
      provider_fingerprint text not null,
      synced_at text not null,
      stale_at text,
      primary key(project_id, channel_id)
    );
    create index if not exists buffer_channels_project_available on buffer_channels(project_id, available, display_name);
    create table if not exists lineage_tasks (
      id text primary key,
      project_id text not null references projects(id),
      root_asset_id text not null references assets(id),
      target_asset_id text not null references assets(id),
      task_type text not null check (task_type in ('iterate', 'reroll')),
      status text not null check (status in ('pending', 'claimed', 'in_progress', 'resolved', 'cancelled')),
      instructions text,
      created_by text not null check (created_by in ('human', 'agent', 'system')),
      created_at text not null,
      updated_at text not null,
      claimed_at text,
      started_at text,
      resolved_at text,
      cancelled_at text,
      resolved_generation_job_id text,
      resolved_asset_id text references assets(id),
      metadata_json text
    );
    create unique index if not exists lineage_tasks_one_open
      on lineage_tasks(project_id, root_asset_id, target_asset_id, task_type)
      where status in ('pending', 'claimed', 'in_progress');
    create index if not exists lineage_tasks_root_status
      on lineage_tasks(project_id, root_asset_id, status, updated_at);
    create index if not exists lineage_tasks_target
      on lineage_tasks(project_id, root_asset_id, target_asset_id, task_type, status);
    create table if not exists lineage_task_events (
      id text primary key,
      task_id text not null references lineage_tasks(id) on delete cascade,
      event_type text not null,
      actor text,
      message text,
      created_at text not null,
      metadata_json text
    );
    create index if not exists lineage_task_events_task_created
      on lineage_task_events(task_id, created_at);
    create table if not exists agent_claims (
      id text primary key,
      token_hash text not null,
      project_id text not null references projects(id),
      channel text,
      scope_type text not null check (scope_type in ('lineage_workspace', 'lineage_task', 'content_post', 'content_queue_lane', 'selection_set', 'project_channel')),
      target_id text not null,
      target_title text,
      agent_id text,
      agent_name text not null,
      agent_kind text not null,
      thread_id text,
      status text not null check (status in ('active', 'expired', 'released', 'revoked', 'transferred')),
      created_at text not null,
      heartbeat_at text not null,
      expires_at text not null,
      released_at text,
      revoked_at text,
      revoked_by text,
      override_reason text,
      metadata_json text
    );
    create unique index if not exists agent_claims_token_hash on agent_claims(token_hash);
    create index if not exists agent_claims_project_status on agent_claims(project_id, status, heartbeat_at);
    create index if not exists agent_claims_target on agent_claims(project_id, channel, scope_type, target_id, status);
    create table if not exists agent_claim_events (
      id text primary key,
      claim_id text not null references agent_claims(id) on delete cascade,
      event_type text not null,
      actor text,
      message text,
      created_at text not null,
      metadata_json text
    );
    create index if not exists agent_claim_events_claim_created on agent_claim_events(claim_id, created_at);
  `);
  ensureColumn(database, 'asset_edges', 'summary', 'text');
  ensureColumn(database, 'asset_edges', 'summary_created_by', "text check (summary_created_by in ('human', 'agent', 'system'))");
  ensureColumn(database, 'asset_edges', 'summary_updated_by', "text check (summary_updated_by in ('human', 'agent', 'system'))");
  ensureColumn(database, 'asset_edges', 'summary_updated_at', 'text');
  ensureColumn(database, 'generation_job_outputs', 'edge_summary', 'text');
  migrateAssetSelections(database);
  dropLegacyAssetSelectionRootUnique(database);
  ensureColumn(database, 'asset_selections', 'notes', 'text');
  backfillLineageTasks(database);
  ensureColumn(database, 'asset_ledger_records', 'first_seen_at', 'text');
  ensureColumn(database, 'asset_ledger_records', 'indexed_by_run_id', 'text');
  ensureColumn(database, 'asset_ledger_sources', 'first_seen_at', 'text');
  ensureColumn(database, 'asset_ledger_sources', 'indexed_by_run_id', 'text');
  ensureReviewStateValues(database);
  ensureAgentClaimScopeValues(database);
  ensureGenerationReceiptCheckValues(database);
  return database;
}

export function backfillLineageTasks(database: DatabaseSync): void {
  database.exec(`
    create table if not exists lineage_schema_migrations (
      key text primary key,
      applied_at text not null
    )
  `);
  const marker = database.prepare("select key from lineage_schema_migrations where key = 'lineage_tasks_backfilled_v1'").get();
  if (marker) return;

  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec(`
      insert or ignore into lineage_tasks (
        id, project_id, root_asset_id, target_asset_id, task_type, status, instructions,
        created_by, created_at, updated_at, metadata_json
      )
      select
        s.project_id || ':' || s.root_asset_id || ':lineage-task:iterate:' || s.asset_id,
        s.project_id,
        s.root_asset_id,
        s.asset_id,
        'iterate',
        'pending',
        s.notes,
        'human',
        s.selected_at,
        s.selected_at,
        null
      from asset_selections s;

      insert or ignore into lineage_tasks (
        id, project_id, root_asset_id, target_asset_id, task_type, status, instructions,
        created_by, created_at, updated_at, metadata_json
      )
      select
        r.project_id || ':' || r.root_asset_id || ':lineage-task:reroll:' || r.node_asset_id,
        r.project_id,
        r.root_asset_id,
        r.node_asset_id,
        'reroll',
        'pending',
        r.notes,
        r.requested_by,
        r.created_at,
        r.created_at,
        null
      from asset_reroll_requests r
      where r.status = 'pending';
    `);
    database.prepare(`
      insert into lineage_schema_migrations (key, applied_at)
      values ('lineage_tasks_backfilled_v1', ?)
      on conflict(key) do nothing
    `).run(nowIso());
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function ensureColumn(database: DatabaseSync, table: string, column: string, definition: string): void {
  const rows = database.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>;
  if (!rows.some(row => row.name === column)) database.exec(`alter table ${table} add column ${column} ${definition}`);
}

function migrateAssetSelections(database: DatabaseSync): void {
  const rows = database.prepare('pragma table_info(asset_selections)').all() as Array<{ name: string }>;
  if (rows.some(row => row.name === 'position')) return;
  const notesSelect = rows.some(row => row.name === 'notes') ? 'notes' : 'null';

  database.exec(`
    create table if not exists asset_selections_v2 (
      id text primary key,
      project_id text not null references projects(id),
      root_asset_id text not null references assets(id),
      asset_id text not null references assets(id),
      position integer not null default 0,
      notes text,
      selected_at text not null,
      unique(project_id, root_asset_id, asset_id)
    );
    insert or ignore into asset_selections_v2 (id, project_id, root_asset_id, asset_id, position, notes, selected_at)
      select
        project_id || ':' || root_asset_id || ':selected:' || asset_id,
        project_id,
        root_asset_id,
        asset_id,
        0,
        ${notesSelect},
        selected_at
      from asset_selections;
    drop table asset_selections;
    alter table asset_selections_v2 rename to asset_selections;
    create index if not exists asset_selections_project_root_position
      on asset_selections(project_id, root_asset_id, position, selected_at);
  `);
}

function dropLegacyAssetSelectionRootUnique(database: DatabaseSync): void {
  const indexes = database.prepare('pragma index_list(asset_selections)').all() as Array<{ name: string; unique: number }>;
  for (const index of indexes) {
    if (!index.unique) continue;
    const columns = database.prepare(`pragma index_info(${index.name})`).all() as Array<{ name: string }>;
    const columnNames = columns.map(column => column.name).join(',');
    if (columnNames === 'project_id,root_asset_id') database.exec(`drop index if exists ${index.name}`);
  }
}

function ensureReviewStateValues(database: DatabaseSync): void {
  const createSql = database.prepare("select sql from sqlite_master where type = 'table' and name = 'asset_reviews'").get() as { sql?: string } | undefined;
  if (createSql?.sql?.includes('needs_revision')) return;

  database.exec(`
    alter table asset_reviews rename to asset_reviews_old;
    create table asset_reviews (
      asset_id text primary key references assets(id),
      review_state text not null check (review_state in ('unreviewed', 'approved', 'needs_revision', 'rejected', 'ignored')),
      reviewed_at text,
      ignored_at text,
      notes text,
      updated_at text not null
    );
    insert into asset_reviews (asset_id, review_state, reviewed_at, ignored_at, notes, updated_at)
    select asset_id, review_state, reviewed_at, ignored_at, notes, updated_at
    from asset_reviews_old;
    drop table asset_reviews_old;
  `);
}

function ensureAgentClaimScopeValues(database: DatabaseSync): void {
  const createSql = database.prepare("select sql from sqlite_master where type = 'table' and name = 'agent_claims'").get() as { sql?: string } | undefined;
  if (createSql?.sql?.includes("'lineage_task'")) return;

  database.exec('PRAGMA foreign_keys = OFF; PRAGMA legacy_alter_table = ON; BEGIN IMMEDIATE');
  try {
    database.exec(`
      alter table agent_claims rename to agent_claims_old;
      create table agent_claims (
        id text primary key,
        token_hash text not null,
        project_id text not null references projects(id),
        channel text,
        scope_type text not null check (scope_type in ('lineage_workspace', 'lineage_task', 'content_post', 'content_queue_lane', 'selection_set', 'project_channel')),
        target_id text not null,
        target_title text,
        agent_id text,
        agent_name text not null,
        agent_kind text not null,
        thread_id text,
        status text not null check (status in ('active', 'expired', 'released', 'revoked', 'transferred')),
        created_at text not null,
        heartbeat_at text not null,
        expires_at text not null,
        released_at text,
        revoked_at text,
        revoked_by text,
        override_reason text,
        metadata_json text
      );
      insert into agent_claims
      select * from agent_claims_old;
      drop table agent_claims_old;
      create unique index if not exists agent_claims_token_hash on agent_claims(token_hash);
      create index if not exists agent_claims_project_status on agent_claims(project_id, status, heartbeat_at);
      create index if not exists agent_claims_target on agent_claims(project_id, channel, scope_type, target_id, status);
    `);
    const violations = database.prepare('pragma foreign_key_check').all();
    if (violations.length > 0) throw new Error(`Agent claim scope migration failed foreign key check: ${JSON.stringify(violations)}`);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.exec('PRAGMA legacy_alter_table = OFF; PRAGMA foreign_keys = ON');
  }
}

function tableCreateSql(database: DatabaseSync, table: string): string {
  const row = database.prepare("select sql from sqlite_master where type = 'table' and name = ?").get(table) as { sql?: string } | undefined;
  return row?.sql || '';
}

function ensureGenerationReceiptCheckValues(database: DatabaseSync): void {
  const jobsSql = tableCreateSql(database, 'generation_jobs');
  const inputsSql = tableCreateSql(database, 'generation_job_inputs');
  const needsJobsMigration = Boolean(jobsSql && !jobsSql.includes("'lineage_reroll'"));
  const needsInputsMigration = Boolean(inputsSql && !inputsSql.includes("'reroll_target'"));
  if (!needsJobsMigration && !needsInputsMigration) return;

  database.exec('PRAGMA foreign_keys = OFF; PRAGMA legacy_alter_table = ON; BEGIN IMMEDIATE');
  try {
    if (needsJobsMigration) migrateGenerationJobsCheck(database);
    if (needsInputsMigration) migrateGenerationJobInputsCheck(database);
    const violations = database.prepare('pragma foreign_key_check').all();
    if (violations.length > 0) throw new Error(`Generation receipt migration failed foreign key check: ${JSON.stringify(violations)}`);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.exec('PRAGMA legacy_alter_table = OFF; PRAGMA foreign_keys = ON');
  }
}

function migrateGenerationJobsCheck(database: DatabaseSync): void {
  database.exec(`
    alter table generation_jobs rename to generation_jobs_legacy_check;
    create table generation_jobs (
      id text primary key,
      project_id text not null references projects(id),
      provider text not null default 'codex-handoff',
      adapter_version text not null,
      source_mode text not null check (source_mode in ('lineage_selection', 'lineage_reroll')),
      root_asset_id text not null references assets(id),
      prompt text not null,
      expected_output_count integer not null check (expected_output_count > 0),
      status text not null check (status in ('planned', 'imported', 'failed', 'cancelled')),
      output_dir text,
      handoff_json text,
      created_at text not null,
      updated_at text not null,
      imported_at text
    );
    insert into generation_jobs (
      id, project_id, provider, adapter_version, source_mode, root_asset_id, prompt,
      expected_output_count, status, output_dir, handoff_json, created_at, updated_at, imported_at
    )
    select
      id, project_id, provider, adapter_version, source_mode, root_asset_id, prompt,
      expected_output_count, status, output_dir, handoff_json, created_at, updated_at, imported_at
    from generation_jobs_legacy_check;
    drop table generation_jobs_legacy_check;
    create index if not exists generation_jobs_project_created on generation_jobs(project_id, created_at);
  `);
}

function migrateGenerationJobInputsCheck(database: DatabaseSync): void {
  database.exec(`
    alter table generation_job_inputs rename to generation_job_inputs_legacy_check;
    create table generation_job_inputs (
      id text primary key,
      job_id text not null references generation_jobs(id) on delete cascade,
      project_id text not null references projects(id),
      asset_id text not null references assets(id),
      root_asset_id text not null references assets(id),
      role text not null check (role in ('lineage_next_base', 'reference', 'reroll_target')),
      position integer not null,
      selection_strategy text not null,
      selection_snapshot_json text not null,
      unique(job_id, asset_id, role)
    );
    insert into generation_job_inputs (
      id, job_id, project_id, asset_id, root_asset_id, role, position, selection_strategy, selection_snapshot_json
    )
    select
      id, job_id, project_id, asset_id, root_asset_id, role, position, selection_strategy, selection_snapshot_json
    from generation_job_inputs_legacy_check;
    drop table generation_job_inputs_legacy_check;
    create index if not exists generation_job_inputs_job on generation_job_inputs(job_id, position);
  `);
}
