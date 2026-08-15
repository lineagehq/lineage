import { expect, test } from 'playwright/test';

test('production transport does not expose provider-mutation or delivery-lifecycle routes', async ({ request }) => {
  const qaHarness = await request.get('/api/social/qa/gate5-scenarios?project=demo');
  expect(qaHarness.status()).toBe(200);
  expect(qaHarness.headers()['content-type']).toContain('text/html');
  expect(await qaHarness.text()).not.toContain('lineage.social_gate5');
  const response = await request.post('/api/social/variants/fixture-never-dispatched/schedule', {
    data: {
      project: 'demo',
      expectedRevision: 1,
      previewSha256: 'a'.repeat(64),
      confirmExternal: true,
    },
  });
  expect(response.status()).toBe(404);

  const status = await request.get('/api/social/deliveries/fixture-never-dispatched?project=demo');
  expect(status.status()).toBe(200);
  expect(status.headers()['content-type']).toContain('text/html');
  const lifecycle = await request.post('/api/social/deliveries/fixture-never-dispatched/lifecycle-confirm', {
    data: { project: 'demo', action: 'retry', confirmExternal: true },
  });
  expect(lifecycle.status()).toBe(404);
});
