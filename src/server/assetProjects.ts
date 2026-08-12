import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertProjectCatalogPathSafe, cleanProject, defaultProject, loadCatalog, normalizeCatalog, repoRoot, validateProject } from './assetCore';
import type { AssetCatalog, ProjectSummary } from '../shared/types';

export interface ProjectInitOptions {
  defaultBucket?: string;
  defaultRegion?: string;
  product?: string;
}

export interface ProjectInitResult {
  created: boolean;
  project: ProjectSummary;
  catalogPath: string;
}

export function initProject(project: string, options: ProjectInitOptions = {}): ProjectInitResult {
  const safeProject = cleanProject(project);
  const path = assertProjectCatalogPathSafe(safeProject);
  if (existsSync(path)) return { created: false, project: validateProject(safeProject), catalogPath: path };

  let defaultCatalog: AssetCatalog | undefined;
  try {
    defaultCatalog = loadCatalog(defaultProject);
  } catch {
    defaultCatalog = undefined;
  }

  const catalog = normalizeCatalog({
    assets: [],
    default_bucket: options.defaultBucket || defaultCatalog?.default_bucket || '',
    default_region: options.defaultRegion || defaultCatalog?.default_region || 'us-east-1',
    product: options.product || safeProject,
    project: safeProject,
  }, safeProject);
  mkdirSync(join(repoRoot, safeProject, 'assets'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(catalog, null, 2)}\n`);
  return { created: true, project: validateProject(safeProject), catalogPath: path };
}
