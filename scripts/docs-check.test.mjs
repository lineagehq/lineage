import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { parseFrontmatter, validateDocumentation } from './docs-check.mjs';

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

test('parses capability frontmatter lists', () => {
  const parsed = parseFrontmatter(`---
title: Cloud storage
description: Back up approved work.
currentProviders:
  - Amazon S3
---

# Cloud storage
`);
  assert.equal(parsed.data.title, 'Cloud storage');
  assert.deepEqual(parsed.data.currentProviders, ['Amazon S3']);
});

test('validates catalog-backed provider claims, links, and release review', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'lineage-docs-check-'));
  try {
    write(join(temporary, 'src/shared/adapterCatalog.ts'), `const adapterCatalogJson = \`[
      {
        "adapterType": "cloud",
        "capabilityId": "cloud-storage",
        "capabilityLabel": "Cloud storage",
        "description": "Back up assets.",
        "docsSlug": "integrations/cloud-storage",
        "liveBehavior": "available",
        "maturity": "Available",
        "providerId": "s3",
        "providerLabel": "Amazon S3"
      }
    ]\`;`);
    write(join(temporary, 'docs-site/docs-review.json'), JSON.stringify({
      reviewedFor: '1.2.3',
      result: 'updated',
      areas: ['integrations'],
    }));
    write(join(temporary, 'docs-site/src/content/docs/index.md'), `---
title: Home
description: Documentation home.
---

[Cloud storage](/docs/integrations/cloud-storage)
`);
    const capabilityPath = join(temporary, 'docs-site/src/content/docs/integrations/cloud-storage.md');
    write(capabilityPath, `---
title: Cloud storage
description: Back up approved assets.
capability: cloud-storage
maturity: Available
currentProviders:
  - Amazon S3
providerIds:
  - s3
liveBehavior: available
---

# Cloud storage
`);
    write(join(temporary, 'docs-site/src/content/docs/integrations/index.md'), `---
title: Integrations
description: Supported providers.
providerIds:
  - s3
---

# Integrations
`);

    const clean = validateDocumentation({
      rootDir: temporary,
      required: ['index.md', 'integrations/index.md', 'integrations/cloud-storage.md'],
      releaseVersion: '1.2.3',
    });
    assert.deepEqual(clean.errors, []);

    write(capabilityPath, readFileSync(capabilityPath, 'utf8').replace('maturity: Available', 'maturity: Preview'));
    const stale = validateDocumentation({
      rootDir: temporary,
      required: ['index.md', 'integrations/index.md', 'integrations/cloud-storage.md'],
      releaseVersion: '1.2.3',
    });
    assert.ok(stale.errors.includes('cloud-storage maturity does not match catalog'));
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
});

test('rejects stale and malformed release review receipts', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'lineage-docs-review-'));
  try {
    write(join(temporary, 'src/shared/adapterCatalog.ts'), 'const adapterCatalogJson = `[]`;');
    write(join(temporary, 'docs-site/src/content/docs/index.md'), `---
title: Home
description: Documentation home.
---

# Home
`);
    write(join(temporary, 'docs-site/src/content/docs/integrations/index.md'), `---
title: Integrations
description: Supported providers.
providerIds:
---

# Integrations
`);
    write(join(temporary, 'docs-site/docs-review.json'), JSON.stringify({
      reviewedFor: '1.2.2',
      result: 'no-changes',
      areas: ['reference'],
    }));

    const stale = validateDocumentation({
      rootDir: temporary,
      required: ['index.md', 'integrations/index.md'],
      releaseVersion: '1.2.3',
    });
    assert.ok(stale.errors.includes('docs review 1.2.2 does not match required release 1.2.3'));

    write(join(temporary, 'docs-site/docs-review.json'), '{not json');
    const malformed = validateDocumentation({
      rootDir: temporary,
      required: ['index.md', 'integrations/index.md'],
      releaseVersion: '1.2.3',
    });
    assert.ok(malformed.errors.includes('docs-site/docs-review.json is invalid JSON'));
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
});
