import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const uiFiles = [
  'src/web/components/LineageView.tsx',
  'src/web/components/LineageDetailModal.tsx',
  'src/web/components/LineageSidePanel.tsx',
  'src/web/components/LineageContextMenu.tsx',
  'src/web/components/LineageHandoffPanel.tsx',
  'src/web/components/LineageAssetNode.tsx',
  'src/web/components/LineageToolbar.tsx',
  'src/web/components/LineageView.css',
  'src/web/components/LedgerView.tsx',
];

const staleHumanPhrases = [
  'Set next base',
  'Set as next base',
  'Next base selected',
  'Clear selected',
  'Next-base rationale',
  'selected base',
  'Copy base',
  'Agent needs a base',
  'content: "next base"',
  'Create from root',
  'Selection & handoff',
];

describe('Lineage human-facing terminology', () => {
  it('uses next-variation language instead of next-base copy', () => {
    const staleMatches = uiFiles.flatMap(file => {
      const source = readFileSync(file, 'utf8');
      return staleHumanPhrases.flatMap(phrase => source.includes(phrase) ? [`${file}: ${phrase}`] : []);
    });

    expect(staleMatches).toEqual([]);
  });
});
