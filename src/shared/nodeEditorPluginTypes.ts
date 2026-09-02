import type { Capability, Feature, NodeEditorContribution, PluginManifest } from '../../packages/node-editor-protocol/generated/protocol';

export const nodeEditorPluginConfigFileName = 'node-editor-plugins.json';

export interface NodeEditorVerifiedInstallationRecord {
  schemaVersion: 1;
  pluginId: string;
  contributionId: string;
  packageArchivePath: string;
  packageArchiveSha256: string;
  manifestSha256: string;
  extractedRoot: string;
  hostSha256: string;
  editorSha256: string;
}

export interface NodeEditorPluginConfig {
  schemaVersion: 1;
  experimentalEnabled: boolean;
  installations: NodeEditorVerifiedInstallationRecord[];
}

export interface VerifiedNodeEditorPlugin {
  manifest: PluginManifest;
  contribution: NodeEditorContribution;
  installation: NodeEditorVerifiedInstallationRecord;
  hostPath: string;
  editorPath: string;
  protocol: { major: number; minor: number; features: Feature[]; capabilities: Capability[] };
}

export interface NodeEditorPluginSummary {
  pluginId: string;
  packageName: string;
  packageVersion: string;
  displayName: string;
  contribution: {
    id: string;
    displayName: string;
    accepts: NodeEditorContribution['accepts'];
    minimumViewport: NodeEditorContribution['minimumViewport'];
  };
  protocol: { major: number; minor: number; features: string[] };
  eligible?: boolean;
  ineligibleReason?: 'mime-type' | 'size';
}

export interface NodeEditorBrowserLaunch extends NodeEditorSessionLaunch {
  editorUrl: string;
  runtimeOrigin: string;
  pluginDisplayName: string;
}

type NodeEditorHostState = 'starting' | 'ready' | 'stopped' | 'failed';

export interface NodeEditorHostPublicStatus {
  contributionId: string;
  state: NodeEditorHostState;
  startedAt?: string;
  stoppedAt?: string;
  reason?: string;
}

export interface NodeEditorSessionBinding {
  profileId: string;
  pluginId: string;
  contributionId: string;
  processId: string;
  sessionId: string;
  origin: string;
  source: 'browser';
}

export interface NodeEditorSessionLaunch {
  sessionId: string;
  launchCredential: string;
  binding: Omit<NodeEditorSessionBinding, 'processId'>;
  expiresAt: number;
}

export interface NodeEditorProposalDeclaration {
  proposalId: string;
  idempotencyKey: string;
  baseAttemptId: string;
  baseChecksum: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';
  sizeBytes: number;
  checksumSha256: string;
  editSummary?: string;
}

export type NodeEditorTerminalOutcome = {
  outcome: 'accepted';
  sessionId: string;
  proposalId: string;
  assetId: string;
  attemptId: string;
  checksumSha256: string;
} | {
  outcome: 'stale' | 'cancelled';
  sessionId: string;
  proposalId?: string;
  code: 'stale-base' | 'cancelled';
};
