import { lstatSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { ResolvedLineageProfile } from '../../shared/lineageProfileTypes';
import {
  nodeEditorPluginConfigFileName,
  type NodeEditorPluginConfig,
  type NodeEditorVerifiedInstallationRecord,
} from '../../shared/nodeEditorPluginTypes';

export class NodeEditorPluginConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NodeEditorPluginConfigError';
  }
}

export function nodeEditorPluginConfigPath(profile: Pick<ResolvedLineageProfile, 'manifest_path'>): string {
  return join(dirname(profile.manifest_path), nodeEditorPluginConfigFileName);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new NodeEditorPluginConfigError(`${label} has unsupported or missing fields`);
  }
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new NodeEditorPluginConfigError(`${label} must be a non-empty string`);
  return value;
}

function digest(value: unknown, label: string): string {
  const parsed = nonEmptyString(value, label).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(parsed)) throw new NodeEditorPluginConfigError(`${label} must be a hexadecimal SHA-256 digest`);
  return parsed;
}

function parseInstallation(value: unknown, index: number): NodeEditorVerifiedInstallationRecord {
  if (!isRecord(value)) throw new NodeEditorPluginConfigError(`installations[${index}] must be an object`);
  exactKeys(value, ['schemaVersion', 'pluginId', 'contributionId', 'packageArchivePath', 'packageArchiveSha256', 'manifestSha256', 'extractedRoot', 'hostSha256', 'editorSha256'], `installations[${index}]`);
  if (value.schemaVersion !== 1) throw new NodeEditorPluginConfigError(`installations[${index}].schemaVersion must be 1`);
  return {
    schemaVersion: 1,
    pluginId: nonEmptyString(value.pluginId, `installations[${index}].pluginId`),
    contributionId: nonEmptyString(value.contributionId, `installations[${index}].contributionId`),
    packageArchivePath: resolve(nonEmptyString(value.packageArchivePath, `installations[${index}].packageArchivePath`)),
    packageArchiveSha256: digest(value.packageArchiveSha256, `installations[${index}].packageArchiveSha256`),
    manifestSha256: digest(value.manifestSha256, `installations[${index}].manifestSha256`),
    extractedRoot: resolve(nonEmptyString(value.extractedRoot, `installations[${index}].extractedRoot`)),
    hostSha256: digest(value.hostSha256, `installations[${index}].hostSha256`),
    editorSha256: digest(value.editorSha256, `installations[${index}].editorSha256`),
  };
}

function parseNodeEditorPluginConfig(value: unknown): NodeEditorPluginConfig {
  if (!isRecord(value)) throw new NodeEditorPluginConfigError('node editor plugin config must be an object');
  exactKeys(value, ['schemaVersion', 'experimentalEnabled', 'installations'], 'node editor plugin config');
  if (value.schemaVersion !== 1) throw new NodeEditorPluginConfigError('node editor plugin config schemaVersion must be 1');
  if (typeof value.experimentalEnabled !== 'boolean') throw new NodeEditorPluginConfigError('experimentalEnabled must be boolean');
  if (!Array.isArray(value.installations)) throw new NodeEditorPluginConfigError('installations must be an array');
  const installations = value.installations.map(parseInstallation);
  const ids = new Set<string>();
  for (const installation of installations) {
    if (ids.has(installation.contributionId)) throw new NodeEditorPluginConfigError(`duplicate contribution ${installation.contributionId}`);
    ids.add(installation.contributionId);
  }
  return { schemaVersion: 1, experimentalEnabled: value.experimentalEnabled, installations };
}

export function loadNodeEditorPluginConfig(
  profile: Pick<ResolvedLineageProfile, 'manifest_path'>,
  options: { path?: string } = {},
): NodeEditorPluginConfig {
  const path = options.path ? resolve(options.path) : nodeEditorPluginConfigPath(profile);
  try {
    const file = lstatSync(path);
    if (file.isSymbolicLink() || !file.isFile()) throw new NodeEditorPluginConfigError(`node editor plugin config must be a regular file: ${path}`);
    if ((statSync(path).mode & 0o077) !== 0) throw new NodeEditorPluginConfigError(`node editor plugin config must be owner-only: ${path}`);
    return parseNodeEditorPluginConfig(JSON.parse(readFileSync(path, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, experimentalEnabled: false, installations: [] };
    if (error instanceof NodeEditorPluginConfigError) throw error;
    throw new NodeEditorPluginConfigError(`cannot load node editor plugin config ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
