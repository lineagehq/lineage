import type { LineageWorkspace } from './lineageWorkspaceTypes';

type ProjectCatalogState = 'ready' | 'pending_create' | 'pending_delete' | 'missing';
export type CollectionSort = 'manual' | 'name' | 'updated';
export type WorkspaceCollectionKind = 'open' | 'archived';

export interface CollectionPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ProjectWorkspaceSummary {
  id: string;
  display_name: string;
  product: string;
  catalog_path?: string;
  catalog_state: ProjectCatalogState;
  sort_position: number;
  asset_count: number;
  workspace_count: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectCollectionSnapshot {
  projects: ProjectWorkspaceSummary[];
  pagination: CollectionPagination;
  manual_revision: number;
  reorder_enabled: boolean;
  demo_restore_available?: boolean;
  query?: string;
  sort: CollectionSort;
  fetched_at: string;
}

export interface WorkspaceCollectionSnapshot {
  project: ProjectWorkspaceSummary;
  workspaces: LineageWorkspace[];
  collection: WorkspaceCollectionKind;
  pagination: CollectionPagination;
  manual_revision: number;
  reorder_enabled: boolean;
  query?: string;
  sort: CollectionSort;
  fetched_at: string;
}

export interface CollectionReorderFields {
  itemId: string;
  targetIndex: number;
  expectedRevision: number;
  confirmWrite: boolean;
}

export interface DeletionImpactCount {
  table: string;
  count: number;
}

export interface DeletionBlocker {
  code: string;
  message: string;
  count?: number;
}

export interface WorkspaceDeletionPlan {
  schema_version: 'lineage.workspace_deletion_plan.v1';
  digest: string;
  project: string;
  workspace_id: string;
  root_asset_id: string;
  workspace_revision: number;
  collection_revision: number;
  state_digest: string;
  counts: DeletionImpactCount[];
  blockers: DeletionBlocker[];
  preserved: {
    asset_rows: number;
    catalog_records: number;
    local_files: true;
    generated_files: true;
    cloud_objects: true;
  };
}

export interface ProjectDeletionPlan {
  schema_version: 'lineage.project_deletion_plan.v1';
  digest: string;
  project: string;
  display_name: string;
  catalog_path?: string;
  collection_revision: number;
  state_digest: string;
  counts: DeletionImpactCount[];
  blockers: DeletionBlocker[];
  preserved: {
    local_files: true;
    generated_files: true;
    cloud_objects: true;
  };
}
