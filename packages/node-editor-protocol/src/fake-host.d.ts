import type { BootstrapEnvelope, BootstrapExchangeResult, ProxyRequest, ProxyResult, SessionDescriptor, UiBinding } from '../generated/protocol.js';

export declare class FakeNodeEditorHost {
  constructor(options?: {
    document?: Record<string, unknown>;
    now?: () => number;
    origin?: string;
    processOrigin?: string;
    uiSource?: string;
    limits?: Partial<{ maxDocumentBytes: number; maxProposals: number; maxIdempotencyKeys: number; maxRequests: number; maxTraceEntries: number }>;
  });
  prepare(manifest: unknown, hostSupport: unknown): { major: number; minor: number; features: string[]; capabilities: string[] };
  issueBootstrap(): BootstrapEnvelope;
  exchangeBootstrap(input: { credential: string; source: string }): BootstrapExchangeResult;
  consumeUiLaunch(input: { credential: string; binding: UiBinding }): SessionDescriptor;
  revokeProcessCapability(): void;
  proxy(input: { capability: string; request: ProxyRequest }): ProxyResult;
  acceptProposal(proposalId: string): void;
  getRedactedTrace(): Array<Record<string, unknown>>;
}
