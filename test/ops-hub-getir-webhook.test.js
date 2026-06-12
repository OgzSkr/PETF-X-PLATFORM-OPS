import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveGetirApiKeyFromRequest,
  verifyWebhookSecret
} from '../lib/ops-hub/webhooks/webhook-auth.js';
import {
  GETIR_WEBHOOK_PATHS,
  listGetirWebhookEndpoints
} from '../lib/ops-hub/webhooks/getir-webhook-service.js';

test('resolveGetirApiKeyFromRequest reads x-api-key header', () => {
  const secret = resolveGetirApiKeyFromRequest({
    headers: { 'x-api-key': 'getir-secret-123' }
  });
  assert.equal(secret, 'getir-secret-123');
});

test('resolveGetirApiKeyFromRequest supports fetch Headers', () => {
  const headers = new Headers({ 'X-Api-Key': 'abc' });
  const secret = resolveGetirApiKeyFromRequest({ headers });
  assert.equal(secret, 'abc');
});

test('verifyWebhookSecret validates Getir x-api-key values', () => {
  assert.equal(verifyWebhookSecret('same-key', 'same-key'), true);
  assert.equal(verifyWebhookSecret('wrong', 'same-key'), false);
});

test('GETIR_WEBHOOK_PATHS exposes form URLs', () => {
  assert.equal(GETIR_WEBHOOK_PATHS.ordersNew, '/webhooks/v1/getir/orders/new');
  assert.equal(GETIR_WEBHOOK_PATHS.ordersCancelled, '/webhooks/v1/getir/orders/cancelled');
  assert.equal(listGetirWebhookEndpoints().length, 3);
});
