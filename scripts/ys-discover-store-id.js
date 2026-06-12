#!/usr/bin/env node
/**
 * Yemeksepeti store_id / vendor identifier keşfi — Partner API + ops DB.
 */
import { getYemeksepetiAccessToken } from '../lib/channels/yemeksepeti-auth.js';
import { resolveOpsHubConfig } from '../lib/ops-hub/config.js';
import { createOpsPool, closeOpsPool } from '../lib/ops-hub/db/migrate.js';

const cfg = {
  chainId: process.env.YEMEKSEPETI_CHAIN_ID || '',
  vendorId: process.env.YEMEKSEPETI_VENDOR_ID || '',
  clientId: process.env.YEMEKSEPETI_CLIENT_ID || '',
  clientSecret: process.env.YEMEKSEPETI_CLIENT_SECRET || ''
};

const externalId = process.env.YEMEKSEPETI_EXTERNAL_PARTNER_CONFIG_ID || '147852147852';
const candidates = [...new Set([cfg.vendorId, externalId].filter(Boolean))];

async function probeApi(token) {
  const base = `https://yemeksepeti.partner.deliveryhero.io/v2/chains/${encodeURIComponent(cfg.chainId)}`;
  const results = [];

  for (const vendor of candidates) {
    for (const path of [
      `/vendors/${encodeURIComponent(vendor)}/status`,
      `/vendors/${encodeURIComponent(vendor)}/catalog?page=1&page_size=1`
    ]) {
      const response = await fetch(`${base}${path}`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
      });
      const text = await response.text();
      let parsed = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      results.push({
        vendor,
        path,
        status: response.status,
        ok: response.ok,
        body: parsed || text.slice(0, 200)
      });
    }
  }

  return results;
}

async function probeOpsDb() {
  const hub = resolveOpsHubConfig(process.env);
  if (!hub.postgresEnabled) return { rows: [], note: 'postgres disabled' };

  const pool = await createOpsPool(hub.postgresUrl);
  try {
    const result = await pool.query(`
      SELECT DISTINCT
        NULLIF(TRIM(raw_payload->'yemeksepetiOrder'->>'store_id'), '') AS store_id,
        NULLIF(TRIM(raw_payload->'yemeksepetiOrder'->>'vendor_id'), '') AS vendor_id,
        NULLIF(TRIM(raw_payload->'yemeksepetiOrder'->>'external_partner_config_id'), '') AS external_partner_config_id,
        NULLIF(TRIM(raw_payload->'yemeksepetiOrder'->'vendor'->>'store_id'), '') AS vendor_obj_store_id,
        NULLIF(TRIM(raw_payload->'yemeksepetiOrder'->'vendor'->>'id'), '') AS vendor_obj_id
      FROM ops_orders
      WHERE channel = 'yemeksepeti'
    `);
    return { rows: result.rows };
  } finally {
    await closeOpsPool();
  }
}

async function main() {
  const token = await getYemeksepetiAccessToken(cfg);
  const api = await probeApi(token);
  const db = await probeOpsDb();

  const storeIds = new Set();
  for (const row of db.rows || []) {
    for (const value of Object.values(row)) {
      if (value) storeIds.add(String(value));
    }
  }

  const workingVendors = api.filter((row) => row.ok).map((row) => row.vendor);
  const recommendation = {
    platformStoreId: cfg.vendorId || null,
    externalPartnerConfigId: externalId,
    note: 'YS dokümantasyonuna göre store_id genelde kısa kod (jk2w); harici yapılandırma kimliği API vendor segmentinde alternatif olarak kullanılır.',
    apiWorkingVendorIds: [...new Set(workingVendors)],
    discoveredFromDb: [...storeIds]
  };

  console.log(JSON.stringify({ api, db, recommendation }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
