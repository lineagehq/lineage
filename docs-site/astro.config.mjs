import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import 'cookie';

const rawBase = process.env.LINEAGE_DOCS_BASE || '/docs/';
const base = rawBase === '/' ? '/' : rawBase.replace(/\/$/, '');

export default defineConfig({
  base,
  outDir: '../dist/docs-site',
  site: process.env.LINEAGE_DOCS_SITE || 'https://lineage.neonwatty.com',
  integrations: [
    starlight({
      description: 'How to evaluate, use, operate, and integrate Lineage.',
      editLink: {
        baseUrl: 'https://github.com/mean-weasel/lineage/edit/main/docs-site/',
      },
      lastUpdated: true,
      social: [
        {
          href: 'https://github.com/mean-weasel/lineage',
          icon: 'github',
          label: 'GitHub',
        },
      ],
      sidebar: [
        {
          label: 'Start here',
          items: [
            { slug: 'start-here/what-is-lineage' },
            { slug: 'start-here/installation-first-run' },
            { slug: 'start-here/first-workspace' },
            { slug: 'start-here/example-projects' },
          ],
        },
        {
          label: 'Core concepts',
          items: [
            { slug: 'concepts/projects-workspaces-assets' },
            { slug: 'concepts/branches-vs-rerolls' },
            { slug: 'concepts/attempts-current-version' },
            { slug: 'concepts/selections-next-variations' },
            { slug: 'concepts/agent-claims-handoffs' },
          ],
        },
        {
          label: 'Workflows',
          items: [
            { slug: 'workflows/create-grow-lineage' },
            { slug: 'workflows/generate-import-variations' },
            { slug: 'workflows/review-approve-assets' },
            { slug: 'workflows/restore-earlier-attempt' },
            { slug: 'workflows/back-up-approved-assets' },
            { slug: 'workflows/content-batches' },
            { slug: 'workflows/continue-new-agent-session' },
          ],
        },
        {
          label: 'Integrations',
          items: [
            { slug: 'integrations' },
            { slug: 'integrations/cloud-storage' },
            { slug: 'integrations/social-scheduling' },
            { slug: 'integrations/image-generation' },
          ],
        },
        {
          label: 'Operating Lineage',
          items: [
            { slug: 'operations/local-first-data' },
            { slug: 'operations/channels' },
            { slug: 'operations/profiles-database-identity' },
            { slug: 'operations/backup-recovery' },
            { slug: 'operations/troubleshooting' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { slug: 'reference/interface-guide' },
            { slug: 'reference/settings' },
            { slug: 'reference/cli' },
            { slug: 'reference/terminology' },
            { slug: 'reference/release-notes' },
          ],
        },
      ],
      title: 'Lineage Documentation',
    }),
  ],
});
