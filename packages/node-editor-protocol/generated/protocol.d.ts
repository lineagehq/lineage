/* Generated from schemas/protocol.schema.json. Do not edit. */

/**
 * Authoritative wire definitions for protocol major 1.
 */
export type LineageNodeEditorProtocol =
  | PluginManifest
  | InstallEnvelope
  | InstallReceipt
  | BootstrapEnvelope
  | BootstrapExchangeResult
  | SessionDescriptor
  | BrowserMessage
  | ProxyRequest
  | ProxyResult;
export type Identifier = string;
export type CanonicalSemver = string;
/**
 * @minItems 1
 */
export type ProtocolSupport = [ProtocolAdvertisement, ...ProtocolAdvertisement[]];
export type Feature = 'document-read' | 'save-proposal' | 'proposal-status' | 'proposal-cancel' | 'terminal-close';
export type Capability = 'document.read' | 'proposal.create' | 'proposal.status' | 'proposal.cancel' | 'session.close';
export type Digest = string;
export type InstallReceipt =
  | {
      type: 'install.receipt';
      accepted: true;
      pluginId: Identifier;
      packageVersion: CanonicalSemver;
    }
  | {
      type: 'install.receipt';
      accepted: false;
      code: 'integrity-mismatch' | 'invalid-manifest' | 'incompatible-protocol' | 'authority-denied';
    };
export type OpaqueToken = string;
export type BrowserMessage =
  | {
      type: 'editor.ready';
      sessionId: Identifier;
    }
  | {
      type: 'host.session';
      session: SessionDescriptor;
    }
  | {
      type: 'host.close';
      reason: 'accepted' | 'cancelled' | 'revoked' | 'error';
    }
  | {
      type: 'editor.close-ack';
    };
export type ProxyRequest =
  | {
      type: 'document.read';
      requestId: Identifier;
      binding: ProcessBinding;
    }
  | {
      type: 'proposal.create';
      requestId: Identifier;
      binding: ProcessBinding;
      header: ProposalHeader;
      document: {
        [k: string]: unknown;
      };
    }
  | {
      type: 'proposal.status';
      requestId: Identifier;
      binding: ProcessBinding;
      proposalId: Identifier;
    }
  | {
      type: 'proposal.cancel';
      requestId: Identifier;
      binding: ProcessBinding;
      proposalId: Identifier;
    }
  | {
      type: 'session.close';
      requestId: Identifier;
      binding: ProcessBinding;
    };
export type ProxyResult =
  | {
      type: 'document.result';
      requestId: Identifier;
      revision: number;
      checksum: Digest;
      document: {
        [k: string]: unknown;
      };
    }
  | {
      type: 'proposal.result';
      requestId: Identifier;
      proposalId: Identifier;
      status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
    }
  | {
      type: 'session.closed';
      requestId: Identifier;
      closed: true;
    }
  | {
      type: 'protocol.error';
      requestId: Identifier;
      code:
        | 'invalid-message'
        | 'authority-denied'
        | 'capability-scope-denied'
        | 'plugin-binding-mismatch'
        | 'process-binding-mismatch'
        | 'session-binding-mismatch'
        | 'origin-binding-mismatch'
        | 'source-binding-mismatch'
        | 'capability-expired'
        | 'capability-replayed'
        | 'capability-revoked'
        | 'resource-limit'
        | 'duplicate-request'
        | 'stale-base'
        | 'duplicate-proposal'
        | 'unknown-proposal'
        | 'proposal-terminal'
        | 'session-terminal';
    };

export interface PluginManifest {
  schemaVersion: 1;
  pluginId: Identifier;
  packageName: string;
  packageVersion: CanonicalSemver;
  displayName: string;
  protocol: ProtocolSupport;
  /**
   * @minItems 1
   * @maxItems 1
   */
  nodeEditors: [NodeEditorContribution];
}
export interface ProtocolAdvertisement {
  major: number;
  minMinor: number;
  maxMinor: number;
  features: Feature[];
  requiredFeatures: Feature[];
}
export interface NodeEditorContribution {
  kind: 'nodeEditor';
  id: Identifier;
  displayName: string;
  accepts: ArtifactEligibility;
  editor: EditorLaunch;
  minimumViewport: MinimumViewport;
  requestedCapabilities: Capability[];
  health: HealthDeclaration;
}
export interface ArtifactEligibility {
  /**
   * @minItems 1
   */
  mimeTypes: [
    'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml',
    ...('image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml')[]
  ];
  maxBytes: number;
}
export interface EditorLaunch {
  entrypoint: string;
  origin: string;
}
export interface MinimumViewport {
  width: number;
  height: number;
}
export interface HealthDeclaration {
  kind: 'process-heartbeat';
  intervalMs: number;
  timeoutMs: number;
}
export interface InstallEnvelope {
  type: 'install.request';
  expectedIntegrity: Digest;
  manifest: PluginManifest;
}
export interface BootstrapEnvelope {
  type: 'bootstrap';
  pluginId: Identifier;
  processId: Identifier;
  sessionId: Identifier;
  bootstrapCredential: OpaqueToken;
  expiresAt: number;
}
export interface BootstrapExchangeResult {
  type: 'bootstrap.accepted';
  processCapability: OpaqueToken;
  uiLaunchCredential: OpaqueToken;
  processBinding: ProcessBinding;
  uiBinding: UiBinding;
  expiresAt: number;
}
export interface ProcessBinding {
  pluginId: Identifier;
  processId: Identifier;
  sessionId: Identifier;
  origin: string;
  source: Identifier;
}
export interface UiBinding {
  pluginId: Identifier;
  sessionId: Identifier;
  origin: string;
  source: Identifier;
}
export interface SessionDescriptor {
  type: 'session.descriptor';
  sessionId: Identifier;
  pluginId: Identifier;
  origin: string;
  protocol: {
    major: number;
    minor: number;
  };
  features: Feature[];
  capabilities: Capability[];
}
export interface ProposalHeader {
  proposalId: Identifier;
  idempotencyKey: Identifier;
  baseRevision: number;
  baseChecksum: Digest;
}
