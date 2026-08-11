import type { AssetSocialMarkMutationResponse as LegacyAssetSocialMarkMutationResponse } from './socialMarkTypes';

export type {
  AssetSocialMark,
  AssetSocialMarksResponse,
} from './socialMarkTypes';

export type AssetSocialMarkMutationResponse = LegacyAssetSocialMarkMutationResponse & {
  schema_version: 'lineage.social_mark_mutation.v1';
};
