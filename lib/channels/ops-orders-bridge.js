import { resolveRealUtcOrderDateRange } from '../order-profitability.js';
import { ORDER_SOURCES } from '../production/constants.js';
import { normalizeYemeksepetiOrder } from './yemeksepeti-orders.js';

/** Ops Hub kanal id → buybox kanal id */
export const OPS_CHANNEL_BY_BUYBOX = Object.freeze({
  'uber-eats': 'trendyol_go',
  yemeksepeti: 'yemeksepeti'
});

export function dedupeOrderPackages(packages) {
  const seen = new Set();
  const out = [];
  for (const pkg of packages) {
    const key = String(pkg.shipmentPackageId || pkg.orderNumber || pkg.id || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(pkg);
  }
  return out;
}

async function resolveOpsPool() {
  try {
    const { bootstrapOpsHub, getOpsHubPool, isOpsHubReady } = await import('../ops-hub/bootstrap.js');
    const { readEnvFile } = await import('../env.js');
    const { paths } = await import('../config.js');
    if (!isOpsHubReady()) {
      await bootstrapOpsHub(await readEnvFile(paths.platformEnv));
    }
    return getOpsHubPool();
  } catch {
    return null;
  }
}

function parseLinesJson(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function lineSalesTotal(lines) {
  return lines.reduce((sum, line) => {
    const qty = Number(line.quantity) || 1;
    const unit = Number(line.unit_price ?? line.unitPrice) || 0;
    return sum + qty * unit;
  }, 0);
}

function mapOpsLinesToProfitLines(lines) {
  return lines.map((line) => ({
    barcode: String(line.barcode || '').trim(),
    productName: line.title || '',
    quantity: Number(line.quantity) || 1,
    lineUnitPrice: Number(line.unit_price ?? line.unitPrice) || 0,
    unitPrice: Number(line.unit_price ?? line.unitPrice) || 0,
    stockCode: line.channel_product_id || line.channelProductId || ''
  }));
}

export function packageFromYemeksepetiOpsRow(row) {
  const raw = row.raw_payload || {};
  const order = raw.yemeksepetiOrder || raw.order;
  if (order && typeof order === 'object') {
    return {
      ...normalizeYemeksepetiOrder(order),
      ingestSource: row.ingest_source || ORDER_SOURCES.WEBHOOK
    };
  }

  const lines = mapOpsLinesToProfitLines(parseLinesJson(row.lines));
  if (!lines.length && !row.external_id) {
    return null;
  }

  return {
    orderNumber: row.display_id || row.external_id,
    shipmentPackageId: row.external_id,
    orderDate: row.ordered_at,
    status: row.channel_status || row.status || '',
    packageGrossAmount: lineSalesTotal(parseLinesJson(row.lines)),
    lines,
    ingestSource: row.ingest_source || ORDER_SOURCES.WEBHOOK
  };
}

export function packageFromUberOpsRow(row) {
  const raw = row.raw_payload || {};
  const lines = mapOpsLinesToProfitLines(parseLinesJson(row.lines));
  const gross = Number(raw.grossAmount ?? raw.totalPrice) || lineSalesTotal(parseLinesJson(row.lines));

  return {
    orderNumber: row.display_id || row.external_id,
    shipmentPackageId: row.external_id,
    orderDate: row.ordered_at,
    status: row.channel_status || row.status || '',
    packageGrossAmount: gross,
    lines,
    ingestSource: row.ingest_source || ORDER_SOURCES.WEBHOOK
  };
}

/**
 * Ops Postgres (webhook + poll) siparişlerini kârlılık paket formatına çevirir.
 */
export async function fetchOpsOrderPackages(buyboxChannelId, options = {}) {
  const opsChannel = OPS_CHANNEL_BY_BUYBOX[buyboxChannelId];
  if (!opsChannel) return [];

  const pool = await resolveOpsPool();
  if (!pool) return [];

  const { startDate, endDate } = resolveRealUtcOrderDateRange(options);
  const result = await pool.query(
    `SELECT o.external_id, o.display_id, o.status, o.channel_status, o.ordered_at,
            o.ingest_source, o.raw_payload,
            COALESCE(
              json_agg(
                json_build_object(
                  'barcode', l.barcode,
                  'title', l.title,
                  'quantity', l.quantity,
                  'unit_price', l.unit_price,
                  'channel_product_id', l.channel_product_id
                )
                ORDER BY l.line_index
              ) FILTER (WHERE l.id IS NOT NULL),
              '[]'::json
            ) AS lines
     FROM ops_orders o
     LEFT JOIN ops_order_lines l ON l.order_id = o.id
     WHERE o.channel = $1
     GROUP BY o.id
     ORDER BY o.ordered_at DESC
     LIMIT 500`,
    [opsChannel]
  );

  const packages = [];
  for (const row of result.rows) {
    const orderedMs = row.ordered_at ? new Date(row.ordered_at).getTime() : 0;
    if (orderedMs && startDate && orderedMs < startDate) continue;
    if (orderedMs && endDate && orderedMs > endDate) continue;

    if (buyboxChannelId === 'yemeksepeti') {
      const pkg = packageFromYemeksepetiOpsRow(row);
      if (pkg) packages.push(pkg);
      continue;
    }

    if (buyboxChannelId === 'uber-eats') {
      packages.push(packageFromUberOpsRow(row));
    }
  }

  return packages;
}

export async function mergeChannelOrderSources(buyboxChannelId, apiPackages, options = {}) {
  const taggedApi = (apiPackages || []).map((pkg) => ({
    ...pkg,
    ingestSource: pkg.ingestSource || ORDER_SOURCES.PARTNER_API
  }));
  const opsPackages = await fetchOpsOrderPackages(buyboxChannelId, options);
  return dedupeOrderPackages([...taggedApi, ...opsPackages]);
}
