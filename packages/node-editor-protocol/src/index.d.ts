export * from '../generated/protocol.js';

export declare const protocolSchema: Readonly<Record<string, unknown>>;
export declare const knownCapabilities: readonly string[];
export declare const knownFeatures: readonly string[];

export declare class ProtocolError extends Error {
  code: string;
  details?: unknown;
  constructor(code: string, message: string, details?: unknown);
}

export declare function assertWireValue<T = unknown>(definition: string, value: T): T;
export declare function validateManifest<T = unknown>(value: T): T;
export declare function negotiateProtocol(hostSupport: unknown, pluginSupport: unknown): {
  major: number;
  minor: number;
  features: string[];
};
export declare const validatorsByExport: Readonly<Record<string, (value: unknown) => unknown>>;
export { runConformance } from './conformance.js';
