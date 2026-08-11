import type { AssetSocialMarkMutationResponse as LegacyAssetSocialMarkMutationResponse } from './socialMarkTypes';

export { SOCIAL_MARK_NOTES_MAX_CODE_POINTS } from './socialMarkTypes';

export type {
  AssetSocialMark,
  AssetSocialMarkListItem,
  AssetSocialMarksResponse,
} from './socialMarkTypes';

export type AssetSocialMarkMutationResponse = LegacyAssetSocialMarkMutationResponse & {
  schema_version: 'lineage.social_mark_mutation.v1';
};
