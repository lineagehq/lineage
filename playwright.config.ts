import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defineConfig, devices } from 'playwright/test';

const port = Number(process.env.LINEAGE_E2E_PORT || 5197);
const dbPath = process.env.LINEAGE_E2E_DB || join(tmpdir(), `lineage-e2e-${process.pid}.sqlite`);
const richSeedRoot = process.env.LINEAGE_RICH_SEED_ASSET_ROOT || join(process.cwd(), '.asset-scratch', 'e2e-rich-seed');
process.env.LINEAGE_E2E_DB = dbPath;
process.env.LINEAGE_RICH_SEED_ASSET_ROOT = richSeedRoot;
const promptContractE2e = process.env.LINEAGE_PROMPT_CONTRACTS === '1';
const extraWebServers = [
  ['LINEAGE_E2E_FEATURE_OFF_ORIGIN', 'LINEAGE_E2E_FEATURE_OFF_COMMAND'],
  ['LINEAGE_E2E_EXPIRY_ORIGIN', 'LINEAGE_E2E_EXPIRY_COMMAND'],
] as const;
const webServers = [{
  command: `PORT=${port} HOST=127.0.0.1 LINEAGE_E2E_PORT=${port} LINEAGE_DB=${dbPath} LINEAGE_RICH_SEED_ASSET_ROOT=${richSeedRoot} npm run dev`,
  timeout: 120_000,
  url: `http://127.0.0.1:${port}/api/projects`,
  reuseExistingServer: false,
}, ...extraWebServers.flatMap(([originName, commandName]) => process.env[originName] && process.env[commandName] ? [{
  command: process.env[commandName]!, timeout: 120_000, url: `${process.env[originName]}/api/projects`, reuseExistingServer: false,
}] : [])];

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  testIgnore: promptContractE2e ? [] : ['**/prompt-contract-ux.e2e.ts'],
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  outputDir: '.asset-scratch/playwright-results',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: webServers,
});
