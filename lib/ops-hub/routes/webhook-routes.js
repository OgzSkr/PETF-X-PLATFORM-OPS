import { readJsonBody, sendJson } from '../../http/respond.js';
import { isOpsHubReady, getOpsHubPool, getOpsHubState } from '../bootstrap.js';
import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import {
  handleYemeksepetiCatalogWebhook,
  handleYemeksepetiOrderWebhook,
  mapWebhookHealth,
  verifyYemeksepetiWebhookRequest
} from '../webhooks/yemeksepeti-webhook-service.js';
import {
  GETIR_WEBHOOK_PATHS,
  handleGetirCancelledOrderWebhook,
  handleGetirNewOrderWebhook,
  verifyGetirWebhookRequest
} from '../webhooks/getir-webhook-service.js';

export async function handleWebhookRoutes(ctx) {
  const { request, response, url } = ctx;
  const { pathname } = url;

  if (pathname === '/webhooks/v1/health' && request.method === 'GET') {
    await sendJson(response, { ok: true, ...mapWebhookHealth() });
    return true;
  }

  if (!pathname.startsWith('/webhooks/v1/')) {
    return false;
  }

  if (!isOpsHubReady()) {
    await sendJson(response, { error: 'Ops Hub hazır değil' }, 503);
    return true;
  }

  const pool = getOpsHubPool();
  const branchId = getOpsHubState().branch?.id;
  const platformEnv = await readEnvFile(paths.platformEnv);

  if (pathname === '/webhooks/v1/yemeksepeti/orders' && request.method === 'GET') {
    await sendJson(response, {
      ok: true,
      endpoint: '/webhooks/v1/yemeksepeti/orders',
      method: 'POST',
      message: 'Yemeksepeti sipariş webhook hazır — YS POST + webhook secret ile çağırır'
    });
    return true;
  }

  if (pathname === '/webhooks/v1/yemeksepeti/catalog' && request.method === 'GET') {
    await sendJson(response, {
      ok: true,
      endpoint: '/webhooks/v1/yemeksepeti/catalog',
      method: 'POST',
      message: 'Yemeksepeti katalog webhook hazır — YS POST + webhook secret ile çağırır'
    });
    return true;
  }

  if (pathname === '/webhooks/v1/yemeksepeti/orders' && request.method === 'POST') {
    try {
      await verifyYemeksepetiWebhookRequest(request, pool, { branchId, platformEnv });
      const body = await readJsonBody(request);
      const result = await handleYemeksepetiOrderWebhook(pool, body, {
        branchId,
        platformEnv
      });
      await sendJson(response, result, result.duplicate ? 200 : 201);
    } catch (error) {
      await sendJson(response, { error: error.message }, error.statusCode || 500);
    }
    return true;
  }

  if (pathname === '/webhooks/v1/yemeksepeti/catalog' && request.method === 'POST') {
    try {
      await verifyYemeksepetiWebhookRequest(request, pool, { branchId, platformEnv });
      const body = await readJsonBody(request);
      const result = await handleYemeksepetiCatalogWebhook(pool, body, { branchId, platformEnv });
      await sendJson(response, result);
    } catch (error) {
      await sendJson(response, { error: error.message }, error.statusCode || 500);
    }
    return true;
  }

  if (pathname === GETIR_WEBHOOK_PATHS.ordersNew && request.method === 'GET') {
    await sendJson(response, {
      ok: true,
      endpoint: GETIR_WEBHOOK_PATHS.ordersNew,
      method: 'POST',
      message: 'Getir yeni sipariş webhook hazır — Getir POST + x-api-key ile çağırır'
    });
    return true;
  }

  if (pathname === GETIR_WEBHOOK_PATHS.ordersCancelled && request.method === 'GET') {
    await sendJson(response, {
      ok: true,
      endpoint: GETIR_WEBHOOK_PATHS.ordersCancelled,
      method: 'POST',
      message: 'Getir iptal webhook hazır — Getir POST + x-api-key ile çağırır'
    });
    return true;
  }

  if (pathname === GETIR_WEBHOOK_PATHS.ordersNew && request.method === 'POST') {
    try {
      await verifyGetirWebhookRequest(request, pool, { branchId, platformEnv });
      const body = await readJsonBody(request);
      const result = await handleGetirNewOrderWebhook(pool, body, { branchId, platformEnv });
      await sendJson(response, result, 202);
    } catch (error) {
      await sendJson(response, { error: error.message }, error.statusCode || 500);
    }
    return true;
  }

  if (pathname === GETIR_WEBHOOK_PATHS.ordersCancelled && request.method === 'POST') {
    try {
      await verifyGetirWebhookRequest(request, pool, { branchId, platformEnv });
      const body = await readJsonBody(request);
      const result = await handleGetirCancelledOrderWebhook(pool, body, { branchId, platformEnv });
      await sendJson(response, result, 202);
    } catch (error) {
      await sendJson(response, { error: error.message }, error.statusCode || 500);
    }
    return true;
  }

  if (pathname === GETIR_WEBHOOK_PATHS.ordersLegacy && request.method === 'POST') {
    try {
      await verifyGetirWebhookRequest(request, pool, { branchId, platformEnv });
      const body = await readJsonBody(request);
      const result = await handleGetirNewOrderWebhook(pool, body, { branchId, platformEnv });
      await sendJson(response, result, 202);
    } catch (error) {
      await sendJson(response, { error: error.message }, error.statusCode || 500);
    }
    return true;
  }

  return false;
}
