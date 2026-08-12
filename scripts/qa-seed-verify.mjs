#!/usr/bin/env node

const defaults = {
  baseUrl: process.env.LINEAGE_QA_BASE_URL || 'http://lineage.localhost:5197',
  project: process.env.LINEAGE_QA_PROJECT || 'swissifier-demo',
};

const args = parseArgs(process.argv.slice(2));
const baseUrl = String(args['base-url'] || defaults.baseUrl).replace(/\/$/, '');
const project = String(args.project || defaults.project);
const prepare = Boolean(args.prepare);
const json = Boolean(args.json);

const richWorkspaceTitle = 'Swissifier rich demo';
const richMediaTotal = 14;

const failures = [];

try {
  if (prepare) {
    await postJson('/api/lineage-workspaces/demo/swissifier/media/download', { project, confirmWrite: true });
    await postJson('/api/lineage-workspaces/demo/swissifier/seed', { project, confirmWrite: true, activate: true });
  }

  const media = await getJson('/api/lineage-workspaces/demo/swissifier/media');
  const entry = await getJson('/api/projects/demo/swissifier/entry');
  const projectQuery = `project=${encodeURIComponent(project)}`;
  const workspaces = await getJson(`/api/lineage-workspaces?${projectQuery}`);
  const canonicalWorkspace = entry.workspace;
  const richWorkspace = (workspaces.workspaces || []).find(workspace => workspace.id === canonicalWorkspace?.id);
  const rootAssetId = canonicalWorkspace?.root_asset_id;
  if (!rootAssetId) throw new Error('Swissifier demo entry did not return a workspace root.');
  const snapshot = await getJson(`/api/lineage/${encodeURIComponent(rootAssetId)}?${projectQuery}`);

  if (!media.status?.ok) failures.push('Swissifier rich media status endpoint did not return ok=true.');
  if (media.status?.present !== richMediaTotal || media.status?.total !== richMediaTotal) {
    failures.push(`Swissifier rich media is ${media.status?.present ?? 'unknown'}/${media.status?.total ?? 'unknown'}; expected ${richMediaTotal}/${richMediaTotal}.`);
  }
  if ((media.status?.missing || []).length > 0) failures.push(`Swissifier rich media has missing files: ${media.status.missing.join(', ')}`);
  if ((media.status?.invalid || []).length > 0) failures.push(`Swissifier rich media has invalid checksums: ${media.status.invalid.join(', ')}`);

  if (richWorkspace?.title !== richWorkspaceTitle) {
    failures.push(`Rich workspace is "${richWorkspace?.title || 'none'}"; expected "${richWorkspaceTitle}".`);
  }
  if (richWorkspace?.root_asset_id !== rootAssetId) {
    failures.push(`Rich workspace root is "${richWorkspace?.root_asset_id || 'none'}"; expected canonical root "${rootAssetId}".`);
  }

  const nodes = Array.isArray(snapshot.nodes) ? snapshot.nodes : [];
  const pngPreviewNodes = nodes.filter(node => typeof node.preview_url === 'string' && /\.png(?:$|[?&])/i.test(decodeURIComponent(node.preview_url)));
  const svgPreviewNodes = nodes.filter(node => typeof node.preview_url === 'string' && /\.svg(?:$|[?&])/i.test(decodeURIComponent(node.preview_url)));
  const richPathNodes = nodes.filter(node => typeof node.local_path === 'string' && node.local_path.startsWith('rich-demo-drafts/swissifier-v1/'));

  if (nodes.length < richMediaTotal) failures.push(`Snapshot has ${nodes.length} nodes; expected at least ${richMediaTotal}.`);
  if (richPathNodes.length < richMediaTotal) failures.push(`Snapshot has ${richPathNodes.length} rich-demo local paths; expected at least ${richMediaTotal}.`);
  if (pngPreviewNodes.length < richMediaTotal) failures.push(`Snapshot has ${pngPreviewNodes.length} PNG preview URLs; expected at least ${richMediaTotal}.`);
  if (svgPreviewNodes.length > 0) failures.push(`Snapshot still has SVG placeholder preview URLs: ${svgPreviewNodes.map(node => node.asset_id).join(', ')}`);

  const rootNode = nodes.find(node => node.asset_id === rootAssetId) || pngPreviewNodes[0];
  const previewProof = rootNode?.preview_url ? await verifyPreview(rootNode.preview_url) : null;
  if (!previewProof) failures.push('No root PNG preview URL was available to verify.');
  else {
    if (!previewProof.ok) failures.push(`Root preview request failed with HTTP ${previewProof.status}.`);
    if (!/^image\/png\b/i.test(previewProof.contentType)) failures.push(`Root preview content-type is "${previewProof.contentType || 'missing'}"; expected image/png.`);
    if (!previewProof.pngSignature) failures.push('Root preview response does not start with a PNG signature.');
  }

  const result = {
    ok: failures.length === 0,
    baseUrl,
    project,
    active_workspace: richWorkspace?.title || null,
    root_asset_id: richWorkspace?.root_asset_id || null,
    swissifier_media: {
      present: media.status?.present,
      total: media.status?.total,
      missing: media.status?.missing || [],
      invalid: media.status?.invalid || [],
    },
    snapshot: {
      nodes: nodes.length,
      png_preview_urls: pngPreviewNodes.length,
      svg_preview_urls: svgPreviewNodes.length,
      rich_local_paths: richPathNodes.length,
    },
    preview_proof: previewProof,
    failures,
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.ok) {
    process.stdout.write([
      'Lineage QA seed verification passed.',
      `Active workspace: ${result.active_workspace}`,
      `Root asset: ${result.root_asset_id}`,
      `Swissifier media: ${result.swissifier_media.present}/${result.swissifier_media.total}`,
      `PNG preview URLs: ${result.snapshot.png_preview_urls}`,
      `Preview proof: ${result.preview_proof?.contentType || 'unknown'} from ${result.preview_proof?.url || 'unknown'}`,
    ].join('\n') + '\n');
  } else {
    process.stderr.write(`Lineage QA seed verification failed:\n${failures.map(failure => `- ${failure}`).join('\n')}\n`);
    process.stderr.write(`Run with --prepare, or use npm run seed:qa:prepare, to download media and activate the rich seed.\n`);
  }

  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const [key, inlineValue] = arg.slice(2).split('=', 2);
    if (inlineValue !== undefined) {
      parsed[key] = inlineValue;
    } else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      parsed[key] = argv[index + 1];
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

async function getJson(path) {
  const response = await fetch(urlFor(path));
  if (!response.ok) throw new Error(`GET ${path} failed with HTTP ${response.status}`);
  return await response.json();
}

async function postJson(path, body) {
  const response = await fetch(urlFor(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`POST ${path} failed with HTTP ${response.status}: ${await response.text()}`);
  return await response.json();
}

function urlFor(path) {
  const url = new URL(path, `${baseUrl}/`);
  url.searchParams.set('project', project);
  return url.toString();
}

async function verifyPreview(previewUrl) {
  const response = await fetch(new URL(previewUrl, `${baseUrl}/`).toString());
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    ok: response.ok,
    status: response.status,
    url: response.url,
    contentType: response.headers.get('content-type') || '',
    bytes: bytes.length,
    pngSignature: bytes.length >= 8
      && bytes[0] === 0x89
      && bytes[1] === 0x50
      && bytes[2] === 0x4e
      && bytes[3] === 0x47
      && bytes[4] === 0x0d
      && bytes[5] === 0x0a
      && bytes[6] === 0x1a
      && bytes[7] === 0x0a,
  };
}
