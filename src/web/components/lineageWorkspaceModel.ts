import type { LineageWorkspace } from '../../shared/types';

export function lineageWorkspaceRootAssetId(workspace: LineageWorkspace | null | undefined, fallbackAssetId?: string): string {
  return workspace?.root_asset_id || fallbackAssetId || '';
}
