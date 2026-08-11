import {
  listAssetSocialMarks as listLegacyAssetSocialMarks,
  markAssetSocial as markLegacyAssetSocial,
  unmarkAssetSocial as unmarkLegacyAssetSocial,
  type MarkAssetSocialFields,
  type UnmarkAssetSocialFields,
} from '../assetSocialMarks';
import type { AssetSocialMarkMutationResponse, AssetSocialMarksResponse } from '../../shared/socialTypes';

export type { MarkAssetSocialFields, UnmarkAssetSocialFields };

const mutationSchemaVersion = 'lineage.social_mark_mutation.v1' as const;

export function listAssetSocialMarks(project: string, rootAssetId: string): AssetSocialMarksResponse {
  return listLegacyAssetSocialMarks(project, rootAssetId);
}

export function markAssetSocial(project: string, fields: MarkAssetSocialFields): AssetSocialMarkMutationResponse {
  return {
    ...markLegacyAssetSocial(project, fields),
    schema_version: mutationSchemaVersion,
  };
}

export function unmarkAssetSocial(project: string, fields: UnmarkAssetSocialFields): AssetSocialMarkMutationResponse {
  return {
    ...unmarkLegacyAssetSocial(project, fields),
    schema_version: mutationSchemaVersion,
  };
}
