import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import { resolveGetirWebhookSecret } from '../integrations/branch-config-resolver.js';
import {
  isWebhookVerificationDisabled,
  resolveGetirApiKeyFromRequest,
  verifyWebhookSecret
} from './webhook-auth.js';
import { insertShadowEvent } from '../db/repository.js';

export const GETIR_WEBHOOK_PATHS = Object.freeze({
  ordersNew: '/webhooks/v1/getir/orders/new',
  ordersCancelled: '/webhooks/v1/getir/orders/cancelled',
  ordersLegacy: '/webhooks/v1/getir/orders'
});

export async function verifyGetirWebhookRequest(request, pool, options = {}) {
  const platformEnv = options.platformEnv || (await readEnvFile(paths.platformEnv));
  if (isWebhookVerificationDisabled(platformEnv)) {
    return { ok: true, skipped: true };
  }

  const expected = await resolveGetirWebhookSecret(pool, {
    branchId: options.branchId,
    platformEnv
  });
  if (!expected) {
    const error = new Error('Getir webhook secret yapılandırılmamış');
    error.statusCode = 503;
    throw error;
  }

  const provided = resolveGetirApiKeyFromRequest(request);
  if (!verifyWebhookSecret(provided, expected)) {
    const error = new Error('x-api-key geçersiz');
    error.statusCode = 401;
    throw error;
  }

  return { ok: true };
}

async function recordGetirWebhook(pool, body, options = {}) {
  const branchId = options.branchId;
  if (branchId) {
    await insertShadowEvent(pool, {
      branchId,
      orderId: null,
      eventType: options.eventType,
      payload: {
        channel: 'getir',
        kind: options.kind,
        body
      }
    });
  }

  return {
    ok: true,
    accepted: true,
    kind: options.kind,
    message: options.message
  };
}

export async function handleGetirNewOrderWebhook(pool, body, options = {}) {
  return recordGetirWebhook(pool, body, {
    ...options,
    kind: 'new',
    eventType: 'getir_order_new',
    message: 'Getir yeni sipariş webhook kaydedildi — G3 credential sonrası ingest açılacak'
  });
}

export async function handleGetirCancelledOrderWebhook(pool, body, options = {}) {
  return recordGetirWebhook(pool, body, {
    ...options,
    kind: 'cancelled',
    eventType: 'getir_order_cancelled',
    message: 'Getir iptal webhook kaydedildi — G3 credential sonrası ingest açılacak'
  });
}

export function listGetirWebhookEndpoints() {
  return [
    `POST ${GETIR_WEBHOOK_PATHS.ordersNew}`,
    `POST ${GETIR_WEBHOOK_PATHS.ordersCancelled}`,
    `POST ${GETIR_WEBHOOK_PATHS.ordersLegacy}`
  ];
}
