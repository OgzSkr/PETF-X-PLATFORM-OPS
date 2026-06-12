#!/usr/bin/env node
import { YemeksepetiAdapter } from '../lib/channels/yemeksepeti.js';
import { getYemeksepetiAccessToken } from '../lib/channels/yemeksepeti-auth.js';
import { resolveRealUtcOrderDateRange } from '../lib/order-profitability.js';
import { listYemeksepetiVendorIds } from '../lib/channels/yemeksepeti-vendor-ids.js';
import { fetchOpsOrderPackages } from '../lib/channels/ops-orders-bridge.js';
import { bootstrapOpsHub, getOpsHubPool, isOpsHubReady } from '../lib/ops-hub/bootstrap.js';
import { readEnvFile } from '../lib/env.js';
import { paths } from '../lib/config.js';

const API_BASE = 'https://yemeksepeti.partner.deliveryhero.io/v2';

function toIsoUtc(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const adapter = new YemeksepetiAdapter();
const cfg = await adapter.loadConfig();
const env = await readEnvFile(paths.platformEnv);
const token = await getYemeksepetiAccessToken(cfg);
const { startDate, endDate } = resolveRealUtcOrderDateRange({ days: 60 });
const vendors = await listYemeksepetiVendorIds(cfg, env, null);

console.log(JSON.stringify({
  step: 'config',
  chainId: cfg.chainId,
  vendorIds: vendors,
  range: { start: toIsoUtc(startDate), end: toIsoUtc(endDate) }
}, null, 2));

for (const vendor of vendors) {
  const query = new URLSearchParams({
    start_time: toIsoUtc(startDate),
    end_time: toIsoUtc(endDate),
    page_size: '10',
    page: '1'
  });
  const url = `${API_BASE}/chains/${encodeURIComponent(cfg.chainId)}/vendors/${encodeURIComponent(vendor)}/orders?${query}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { parseError: text.slice(0, 200) };
  }
  console.log(JSON.stringify({
    step: 'list_api',
    vendor,
    http: response.status,
    totalPages: data.total_pages,
    totalCount: data.total_count ?? data.total ?? null,
    ordersLen: (data.orders || []).length,
    sampleOrderCode: data.orders?.[0]?.order_code || null,
    sampleOrderId: data.orders?.[0]?.order_id || null
  }, null, 2));
}

if (!isOpsHubReady()) {
  await bootstrapOpsHub(env);
}
const pool = getOpsHubPool();
const opsCount = pool
  ? (await pool.query("SELECT COUNT(*)::int AS c FROM ops_orders WHERE channel = 'yemeksepeti'")).rows[0].c
  : null;
const opsPackages = await fetchOpsOrderPackages('yemeksepeti', { days: 60 });

console.log(JSON.stringify({
  step: 'petfix_ops',
  opsOrdersInDb: opsCount,
  opsPackagesForUi: opsPackages.length,
  opsSample: opsPackages.slice(0, 2).map((p) => ({
    orderNumber: p.orderNumber,
    shipmentPackageId: p.shipmentPackageId,
    ingestSource: p.ingestSource
  }))
}, null, 2));
