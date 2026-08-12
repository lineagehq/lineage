import type express from 'express';
import { LineageError } from '../assetLineage';
import { listAssetSocialMarks, markAssetSocial, unmarkAssetSocial } from './socialMarks';
import { addSocialVariant, archiveSocialWorkItem, createSocialWorkItem, editSocialVariant, getSocialWorkItem, removeSocialVariant } from './socialWorkItems';
import { validateSocialWorkItem } from './socialValidation';

type ProjectFrom = (input: { body?: Record<string, unknown>; query?: Record<string, unknown> }) => string;
type AsyncRoute = (handler: (req: express.Request, res: express.Response) => Promise<void> | void) => express.RequestHandler;

function bodyString(req: express.Request, key: string): string | undefined {
  const value = (req.body as Record<string, unknown> | undefined)?.[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new LineageError(`${key} must be a string`);
  return value;
}

function requestClaimToken(req: express.Request): string | undefined {
  return req.header('X-Lineage-Claim-Token') || bodyString(req, 'claimToken');
}

function bodyStrings(req: express.Request, key: string): string[] | undefined {
  const value = (req.body as Record<string, unknown> | undefined)?.[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every(entry => typeof entry === 'string')) throw new LineageError(`${key} must be an array of strings`);
  return value;
}

function bodyEnum<const T extends string>(req: express.Request, key: string, values: readonly T[]): T | undefined {
  const value = (req.body as Record<string, unknown> | undefined)?.[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !values.includes(value as T)) throw new LineageError(`${key} must be one of: ${values.join(', ')}`);
  return value as T;
}

function bodyBoolean(req: express.Request, key: string): boolean | undefined {
  const value = (req.body as Record<string, unknown> | undefined)?.[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new LineageError(`${key} must be a boolean`);
  return value;
}

function bodyPositiveInteger(req: express.Request, key: string): number | undefined {
  const value = (req.body as Record<string, unknown> | undefined)?.[key];
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || Number(value) < 1) throw new LineageError(`${key} must be a positive integer`);
  return Number(value);
}

function assertBodyFields(req: express.Request, allowed: readonly string[]): void {
  const body = req.body as Record<string, unknown> | undefined;
  for (const key of Object.keys(body || {})) {
    if (!allowed.includes(key)) throw new LineageError(`Unknown Social request field: ${key}`);
  }
}

function assertQueryFields(req: express.Request): void {
  for (const [key, value] of Object.entries(req.query)) {
    if (key !== 'project' && key !== 'product') throw new LineageError(`Unknown Social query field: ${key}`);
    if (typeof value !== 'string' || !value.trim()) throw new LineageError(`${key} query parameter must be a non-empty string`);
  }
}

function assertRequestIdentity(req: express.Request): void {
  const body = req.body as Record<string, unknown> | undefined;
  const identities = [body?.project, body?.product, req.query.project, req.query.product]
    .filter(value => value !== undefined);
  if (identities.some(value => typeof value !== 'string' || !value.trim())) {
    throw new LineageError('project and product identities must be non-empty strings');
  }
  if (new Set((identities as string[]).map(value => value.trim())).size > 1) {
    throw new LineageError('Conflicting project/product identities');
  }
}

function assertSocialRequest(req: express.Request, allowedBody: readonly string[]): void {
  assertBodyFields(req, allowedBody);
  assertQueryFields(req);
  assertRequestIdentity(req);
}

function bodyExpectedVariants(req: express.Request): Array<{ variantId: string; expectedRevision: number }> {
  const value = (req.body as Record<string, unknown> | undefined)?.expectedVariants;
  if (!Array.isArray(value)) throw new LineageError('expectedVariants is required and must be an array');
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new LineageError(`expectedVariants[${index}] must be an object`);
    }
    const record = entry as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key !== 'variantId' && key !== 'expectedRevision') throw new LineageError(`Unknown expectedVariants field: ${key}`);
    }
    if (typeof record.variantId !== 'string' || !record.variantId.trim()) throw new LineageError(`expectedVariants[${index}].variantId must be a non-empty string`);
    if (!Number.isInteger(record.expectedRevision) || Number(record.expectedRevision) < 1) throw new LineageError(`expectedVariants[${index}].expectedRevision must be a positive integer`);
    if (seen.has(record.variantId)) throw new LineageError(`Duplicate expected variant: ${record.variantId}`);
    seen.add(record.variantId);
    return { variantId: record.variantId, expectedRevision: Number(record.expectedRevision) };
  });
}

const commonMutationFields = ['project', 'product', 'actor', 'claimToken', 'confirmWrite'] as const;

export function registerSocialMarkRoutes(app: express.Express, projectFrom: ProjectFrom, asyncRoute: AsyncRoute): void {
  app.post('/api/social/items', asyncRoute((req, res) => {
    assertSocialRequest(req, [...commonMutationFields, 'campaignKey', 'contentPostId', 'rootAssetId', 'sourceAssetId']);
    res.json(createSocialWorkItem(projectFrom({ body: req.body as Record<string, unknown>, query: req.query }), {
      actor: bodyString(req, 'actor'), campaignKey: bodyString(req, 'campaignKey'), claimToken: requestClaimToken(req),
      confirmWrite: req.body?.confirmWrite === true, contentPostId: bodyString(req, 'contentPostId'),
      rootAssetId: bodyString(req, 'rootAssetId') || '', sourceAssetId: bodyString(req, 'sourceAssetId') || '',
    }));
  }));
  app.get('/api/social/items/:itemId', asyncRoute((req, res) => {
    assertSocialRequest(req, []);
    res.json(getSocialWorkItem(projectFrom({ query: req.query }), req.params.itemId));
  }));
  app.post('/api/social/items/:itemId/archive', asyncRoute((req, res) => {
    assertSocialRequest(req, [...commonMutationFields, 'expectedVariants']);
    res.json(archiveSocialWorkItem(projectFrom({ body: req.body as Record<string, unknown>, query: req.query }), {
      actor: bodyString(req, 'actor'), claimToken: requestClaimToken(req), confirmWrite: req.body?.confirmWrite === true,
      expectedVariants: bodyExpectedVariants(req), itemId: req.params.itemId,
    }));
  }));
  app.post('/api/social/items/:itemId/variants', asyncRoute((req, res) => {
    assertSocialRequest(req, [...commonMutationFields, 'channelId']);
    res.json(addSocialVariant(projectFrom({ body: req.body as Record<string, unknown>, query: req.query }), {
      actor: bodyString(req, 'actor'), channelId: bodyString(req, 'channelId') || '', claimToken: requestClaimToken(req),
      confirmWrite: req.body?.confirmWrite === true, itemId: req.params.itemId,
    }));
  }));
  app.post('/api/social/variants/:variantId/edit', asyncRoute((req, res) => {
    assertSocialRequest(req, [...commonMutationFields, 'altText', 'altTextReviewed', 'altTextReviewedBy', 'compositionMode', 'copy', 'customScheduledAt', 'editorialState', 'expectedRevision', 'hashtagPlacement', 'hashtags', 'publishMethod']);
    const compositionMode = bodyEnum(req, 'compositionMode', ['customScheduled', 'addToQueue'] as const);
    const editorialState = bodyEnum(req, 'editorialState', ['draft', 'needs_review', 'ready'] as const);
    const hashtagPlacement = bodyEnum(req, 'hashtagPlacement', ['caption', 'first_comment'] as const);
    const publishMethod = bodyEnum(req, 'publishMethod', ['automatic', 'notification'] as const);
    const expectedRevision = bodyPositiveInteger(req, 'expectedRevision');
    if (expectedRevision === undefined) throw new LineageError('expectedRevision is required');
    res.json(editSocialVariant(projectFrom({ body: req.body as Record<string, unknown>, query: req.query }), {
      actor: bodyString(req, 'actor'), altText: bodyString(req, 'altText'),
      altTextReviewed: bodyBoolean(req, 'altTextReviewed'),
      altTextReviewedBy: bodyString(req, 'altTextReviewedBy'), claimToken: requestClaimToken(req),
      compositionMode,
      confirmWrite: req.body?.confirmWrite === true, copy: bodyString(req, 'copy'), customScheduledAt: bodyString(req, 'customScheduledAt'),
      editorialState,
      expectedRevision,
      hashtagPlacement,
      hashtags: bodyStrings(req, 'hashtags'),
      publishMethod,
      variantId: req.params.variantId,
    }));
  }));
  app.post('/api/social/variants/:variantId/remove', asyncRoute((req, res) => {
    assertSocialRequest(req, [...commonMutationFields, 'expectedRevision']);
    const expectedRevision = bodyPositiveInteger(req, 'expectedRevision');
    if (expectedRevision === undefined) throw new LineageError('expectedRevision is required');
    res.json(removeSocialVariant(projectFrom({ body: req.body as Record<string, unknown>, query: req.query }), {
      actor: bodyString(req, 'actor'), claimToken: requestClaimToken(req), confirmWrite: req.body?.confirmWrite === true,
      expectedRevision, variantId: req.params.variantId,
    }));
  }));
  app.post('/api/social/items/:itemId/preflight', asyncRoute((req, res) => {
    assertSocialRequest(req, ['project', 'product']);
    res.json(validateSocialWorkItem(projectFrom({ body: req.body as Record<string, unknown>, query: req.query }), req.params.itemId));
  }));
  app.get('/api/lineage/:rootAssetId/social-marks', asyncRoute((req, res) => {
    assertSocialRequest(req, []);
    res.json(listAssetSocialMarks(
      projectFrom({ query: req.query }),
      req.params.rootAssetId,
    ));
  }));
  app.post('/api/lineage/:rootAssetId/social-marks/:assetId', asyncRoute((req, res) => {
    assertSocialRequest(req, [...commonMutationFields, 'markedBy', 'notes']);
    res.json(markAssetSocial(projectFrom({ body: req.body as Record<string, unknown>, query: req.query }), {
      asset: req.params.assetId,
      claimToken: requestClaimToken(req),
      confirmWrite: req.body?.confirmWrite === true,
      markedBy: bodyString(req, 'markedBy') || bodyString(req, 'actor') || 'human',
      notes: bodyString(req, 'notes'),
      rootAssetId: req.params.rootAssetId,
    }));
  }));
  app.post('/api/lineage/:rootAssetId/social-marks/:assetId/unmark', asyncRoute((req, res) => {
    assertSocialRequest(req, [...commonMutationFields, 'unmarkedBy']);
    res.json(unmarkAssetSocial(projectFrom({ body: req.body as Record<string, unknown>, query: req.query }), {
      asset: req.params.assetId,
      claimToken: requestClaimToken(req),
      confirmWrite: req.body?.confirmWrite === true,
      rootAssetId: req.params.rootAssetId,
      unmarkedBy: bodyString(req, 'unmarkedBy') || bodyString(req, 'actor') || 'human',
    }));
  }));
}
