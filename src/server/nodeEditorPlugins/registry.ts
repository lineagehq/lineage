import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import type { Capability, Feature, PluginManifest, ProtocolAdvertisement } from '../../../packages/node-editor-protocol/generated/protocol';
import type {
  NodeEditorPluginSummary,
  NodeEditorVerifiedInstallationRecord,
  VerifiedNodeEditorPlugin,
} from '../../shared/nodeEditorPluginTypes';
import type { NodeEditorPluginConfig } from '../../shared/nodeEditorPluginTypes';

const lineageNodeEditorProtocolSupport: ReadonlyArray<Readonly<ProtocolAdvertisement>> = Object.freeze([{
  major: 1,
  minMinor: 0,
  maxMinor: 3,
  features: ['document-read', 'document-content', 'save-proposal', 'proposal-status', 'proposal-cancel', 'terminal-close'],
  requiredFeatures: ['document-read', 'save-proposal', 'terminal-close'],
}]);
const canonicalNodeEditorManifestPath = 'manifest.json';
const canonicalNodeEditorHostPath = 'src/host.js';
const canonicalNodeEditorEditorPath = 'editor/index.html';

export class NodeEditorPluginVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NodeEditorPluginVerificationError';
  }
}

const identifierPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const entrypointPattern = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9][A-Za-z0-9._/-]*\.html$/;
const features = new Set(['document-read', 'document-content', 'save-proposal', 'proposal-status', 'proposal-cancel', 'terminal-close']);
const capabilities = new Set(['document.read', 'proposal.create', 'proposal.status', 'proposal.cancel', 'session.close']);
const mimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);

function record(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new NodeEditorPluginVerificationError(`${label} must be an object`);
  const parsed = value as Record<string, unknown>;
  const actual = Object.keys(parsed).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new NodeEditorPluginVerificationError(`${label} failed exact Phase 1 schema fields`);
  }
  return parsed;
}

function string(value: unknown, label: string, max = 128): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) throw new NodeEditorPluginVerificationError(`${label} must be a bounded string`);
  return value;
}

function integer(value: unknown, label: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new NodeEditorPluginVerificationError(`${label} must be an integer from ${min} to ${max}`);
  return value as number;
}

function uniqueEnumArray(value: unknown, allowed: Set<string>, label: string, minimum = 0): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.some(item => typeof item !== 'string' || !allowed.has(item)) || new Set(value).size !== value.length) {
    throw new NodeEditorPluginVerificationError(`${label} failed Phase 1 enum/uniqueness constraints`);
  }
  return value;
}

function advertisement(value: unknown): ProtocolAdvertisement {
  const item = record(value, ['major', 'minMinor', 'maxMinor', 'features', 'requiredFeatures'], 'protocol advertisement');
  const advertised = uniqueEnumArray(item.features, features, 'protocol features');
  const required = uniqueEnumArray(item.requiredFeatures, features, 'required protocol features');
  const major = integer(item.major, 'protocol major', 1);
  const minMinor = integer(item.minMinor, 'protocol minimum minor', 0);
  const maxMinor = integer(item.maxMinor, 'protocol maximum minor', 0);
  if (maxMinor < minMinor || required.some(item => !advertised.includes(item))) throw new NodeEditorPluginVerificationError('malformed protocol advertisement');
  return { major, minMinor, maxMinor, features: advertised as ProtocolAdvertisement['features'], requiredFeatures: required as ProtocolAdvertisement['requiredFeatures'] };
}

function validateManifest(value: unknown): PluginManifest {
  const manifest = record(value, ['schemaVersion', 'pluginId', 'packageName', 'packageVersion', 'displayName', 'protocol', 'nodeEditors'], 'plugin manifest');
  if (manifest.schemaVersion !== 1) throw new NodeEditorPluginVerificationError('plugin manifest schemaVersion must be 1');
  const pluginId = string(manifest.pluginId, 'pluginId');
  if (!identifierPattern.test(pluginId)) throw new NodeEditorPluginVerificationError('pluginId failed Phase 1 identifier syntax');
  const packageName = string(manifest.packageName, 'packageName', 256);
  if (!/^@[a-z0-9._-]+\/[a-z0-9._-]+$/.test(packageName)) throw new NodeEditorPluginVerificationError('packageName failed Phase 1 syntax');
  const packageVersion = string(manifest.packageVersion, 'packageVersion', 256);
  if (!semverPattern.test(packageVersion)) throw new NodeEditorPluginVerificationError('packageVersion must be canonical SemVer');
  const displayName = string(manifest.displayName, 'displayName', 100);
  if (!Array.isArray(manifest.protocol) || manifest.protocol.length < 1) throw new NodeEditorPluginVerificationError('protocol support must not be empty');
  const protocol = manifest.protocol.map(advertisement);
  if (new Set(protocol.map(item => item.major)).size !== protocol.length) throw new NodeEditorPluginVerificationError('duplicate protocol major advertisement');
  if (!Array.isArray(manifest.nodeEditors) || manifest.nodeEditors.length !== 1) throw new NodeEditorPluginVerificationError('Phase 1 requires exactly one node editor contribution');
  const editor = record(manifest.nodeEditors[0], ['kind', 'id', 'displayName', 'accepts', 'editor', 'minimumViewport', 'requestedCapabilities', 'health'], 'node editor contribution');
  if (editor.kind !== 'nodeEditor') throw new NodeEditorPluginVerificationError('invalid node editor kind');
  const editorId = string(editor.id, 'node editor id');
  if (!identifierPattern.test(editorId)) throw new NodeEditorPluginVerificationError('node editor id failed Phase 1 identifier syntax');
  const editorDisplayName = string(editor.displayName, 'node editor displayName', 100);
  const accepts = record(editor.accepts, ['mimeTypes', 'maxBytes'], 'artifact eligibility');
  const acceptedMimeTypes = uniqueEnumArray(accepts.mimeTypes, mimeTypes, 'accepted MIME types', 1);
  const maxBytes = integer(accepts.maxBytes, 'maximum artifact bytes', 1, 1_073_741_824);
  const launch = record(editor.editor, ['entrypoint', 'origin'], 'editor launch');
  const entrypoint = string(launch.entrypoint, 'editor entrypoint', 1024);
  if (!entrypointPattern.test(entrypoint)) throw new NodeEditorPluginVerificationError('editor entrypoint failed Phase 1 syntax');
  const origin = string(launch.origin, 'editor origin', 2048);
  let parsedOrigin: URL;
  try { parsedOrigin = new URL(origin); } catch { throw new NodeEditorPluginVerificationError('editor origin must be an HTTP origin'); }
  if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.origin !== origin || parsedOrigin.pathname !== '/' || parsedOrigin.search || parsedOrigin.hash || parsedOrigin.username || parsedOrigin.password) {
    throw new NodeEditorPluginVerificationError('editor origin must be an exact HTTP origin');
  }
  const viewport = record(editor.minimumViewport, ['width', 'height'], 'minimum viewport');
  const width = integer(viewport.width, 'minimum viewport width', 320, 8192);
  const height = integer(viewport.height, 'minimum viewport height', 240, 8192);
  const requestedCapabilities = uniqueEnumArray(editor.requestedCapabilities, capabilities, 'requested capabilities');
  const health = record(editor.health, ['kind', 'intervalMs', 'timeoutMs'], 'health declaration');
  if (health.kind !== 'process-heartbeat') throw new NodeEditorPluginVerificationError('invalid health declaration kind');
  const intervalMs = integer(health.intervalMs, 'health interval', 1000, 60000);
  const timeoutMs = integer(health.timeoutMs, 'health timeout', 100, 30000);
  return {
    schemaVersion: 1, pluginId, packageName, packageVersion, displayName,
    protocol: protocol as PluginManifest['protocol'],
    nodeEditors: [{
      kind: 'nodeEditor', id: editorId, displayName: editorDisplayName,
      accepts: { mimeTypes: acceptedMimeTypes as PluginManifest['nodeEditors'][0]['accepts']['mimeTypes'], maxBytes },
      editor: { entrypoint, origin }, minimumViewport: { width, height },
      requestedCapabilities: requestedCapabilities as PluginManifest['nodeEditors'][0]['requestedCapabilities'],
      health: { kind: 'process-heartbeat', intervalMs, timeoutMs },
    }],
  };
}

function negotiateProtocol(hostSupport: ReadonlyArray<Readonly<ProtocolAdvertisement>>, pluginSupport: PluginManifest['protocol']): { major: number; minor: number; features: Feature[] } {
  const candidates: Array<{ major: number; minor: number; features: Feature[] }> = [];
  for (const host of hostSupport) for (const plugin of pluginSupport) {
    if (host.major !== plugin.major) continue;
    const min = Math.max(host.minMinor, plugin.minMinor);
    const max = Math.min(host.maxMinor, plugin.maxMinor);
    if (max < min) continue;
    const shared = host.features.filter(feature => plugin.features.includes(feature)).sort();
    if (![...host.requiredFeatures, ...plugin.requiredFeatures].every(feature => shared.includes(feature))) continue;
    candidates.push({ major: host.major, minor: max, features: shared as Feature[] });
  }
  candidates.sort((left, right) => right.major - left.major || right.minor - left.minor || left.features.join(',').localeCompare(right.features.join(',')));
  if (!candidates[0]) throw new NodeEditorPluginVerificationError('no compatible protocol range and required-feature intersection');
  return candidates[0];
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertRegularFile(path: string, label: string): void {
  const link = lstatSync(path);
  if (link.isSymbolicLink() || !link.isFile() || !statSync(path).isFile()) {
    throw new NodeEditorPluginVerificationError(`${label} must be a regular non-symlink file`);
  }
}

function assertInsideRoot(root: string, path: string, label: string): void {
  const child = relative(root, path);
  if (child === '..' || child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(child)) {
    throw new NodeEditorPluginVerificationError(`${label} must be inside the extracted root`);
  }
}

function verifyNodeEditorInstallation(record: NodeEditorVerifiedInstallationRecord): VerifiedNodeEditorPlugin {
  try {
    const extractedRoot = realpathSync(record.extractedRoot);
    if (!statSync(extractedRoot).isDirectory()) throw new NodeEditorPluginVerificationError('extracted root must be a directory');
    const manifestPath = realpathSync(join(extractedRoot, canonicalNodeEditorManifestPath));
    const hostPath = realpathSync(join(extractedRoot, canonicalNodeEditorHostPath));
    const editorPath = realpathSync(join(extractedRoot, canonicalNodeEditorEditorPath));
    assertInsideRoot(extractedRoot, manifestPath, 'manifest');
    assertInsideRoot(extractedRoot, hostPath, 'host executable');
    assertInsideRoot(extractedRoot, editorPath, 'editor entrypoint');
    assertRegularFile(record.packageArchivePath, 'package archive');
    assertRegularFile(manifestPath, 'manifest');
    assertRegularFile(hostPath, 'host executable');
    assertRegularFile(editorPath, 'editor entrypoint');
    const archiveBytes = readFileSync(record.packageArchivePath);
    const manifestBytes = readFileSync(manifestPath);
    const hostBytes = readFileSync(hostPath);
    const editorBytes = readFileSync(editorPath);
    if (sha256(archiveBytes) !== record.packageArchiveSha256) throw new NodeEditorPluginVerificationError('package archive SHA-256 mismatch');
    if (sha256(manifestBytes) !== record.manifestSha256) throw new NodeEditorPluginVerificationError('exact manifest-byte SHA-256 mismatch');
    if (sha256(hostBytes) !== record.hostSha256) throw new NodeEditorPluginVerificationError('exact host-executable SHA-256 mismatch');
    if (sha256(editorBytes) !== record.editorSha256) throw new NodeEditorPluginVerificationError('exact editor-byte SHA-256 mismatch');
    const manifest = validateManifest(JSON.parse(manifestBytes.toString('utf8')));
    if (manifest.pluginId !== record.pluginId) throw new NodeEditorPluginVerificationError('installation plugin id does not match manifest');
    const contribution = manifest.nodeEditors.find(candidate => candidate.id === record.contributionId);
    if (!contribution) throw new NodeEditorPluginVerificationError('installation contribution id does not match manifest');
    negotiateProtocol(lineageNodeEditorProtocolSupport, manifest.protocol);
    const negotiated = negotiateProtocol(lineageNodeEditorProtocolSupport, manifest.protocol);
    return {
      manifest, contribution, installation: { ...record, extractedRoot }, hostPath, editorPath,
      protocol: { ...negotiated, capabilities: contribution.requestedCapabilities as Capability[] },
    };
  } catch (error) {
    if (error instanceof NodeEditorPluginVerificationError) throw error;
    throw new NodeEditorPluginVerificationError(`installation verification failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function publicNodeEditorPluginSummary(plugin: VerifiedNodeEditorPlugin): NodeEditorPluginSummary {
  const protocol = negotiateProtocol(lineageNodeEditorProtocolSupport, plugin.manifest.protocol);
  return {
    pluginId: plugin.manifest.pluginId,
    packageName: plugin.manifest.packageName,
    packageVersion: plugin.manifest.packageVersion,
    displayName: plugin.manifest.displayName,
    contribution: {
      id: plugin.contribution.id,
      displayName: plugin.contribution.displayName,
      accepts: plugin.contribution.accepts,
      minimumViewport: plugin.contribution.minimumViewport,
    },
    protocol,
  };
}

export class NodeEditorPluginRegistry {
  readonly #records: Map<string, NodeEditorVerifiedInstallationRecord>;

  constructor(config: NodeEditorPluginConfig) {
    this.#records = new Map(config.installations.map(record => [record.contributionId, record]));
  }

  list(): VerifiedNodeEditorPlugin[] {
    return [...this.#records.values()].map(verifyNodeEditorInstallation);
  }

  get(contributionId: string): VerifiedNodeEditorPlugin {
    const record = this.#records.get(contributionId);
    if (!record) throw new NodeEditorPluginVerificationError(`unknown node editor contribution ${contributionId}`);
    return verifyNodeEditorInstallation(record);
  }
}
