export type LineageWorkspaceStatus = 'active' | 'paused' | 'archived';
export type LineageWorkspaceActor = 'human' | 'agent' | 'system';

export interface LineageWorkspace {
  id: string;
  project: string;
  root_asset_id: string;
  title: string;
  status: LineageWorkspaceStatus;
  notes?: string;
  created_by: LineageWorkspaceActor;
  active_at?: string;
  created_at: string;
  updated_at: string;
  sort_position?: number;
  collection_kind?: 'open' | 'archived';
  revision?: number;
  max_queued_branches?: number;
}

export interface LineageWorkspaceSnapshot {
  project: string;
  active_workspace: LineageWorkspace | null;
  workspaces: LineageWorkspace[];
  fetchedAt: string;
}

export interface LineageWorkspaceFields {
  rootAssetId: string;
  title?: string;
  status?: LineageWorkspaceStatus;
  notes?: string;
  createdBy?: LineageWorkspaceActor;
  activate?: boolean;
  restoreDeleted?: boolean;
  confirmWrite: boolean;
}

export interface LineageWorkspaceUpdateFields {
  title?: string;
  status?: LineageWorkspaceStatus;
  notes?: string;
  activate?: boolean;
  maxQueuedBranches?: number;
  confirmWrite: boolean;
}
