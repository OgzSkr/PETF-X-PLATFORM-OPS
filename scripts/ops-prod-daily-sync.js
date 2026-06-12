#!/usr/bin/env node
/**
 * Production günlük bakım: BenimPOS master/maliyet + YS katalog + otomatik eşleştirme.
 * VPS cron veya: docker exec petfix-prod-api node scripts/ops-prod-daily-sync.js
 */
import { createBenimposService } from '../lib/platform/services/benimpos.js';
import { createProductMatchingService } from '../lib/platform/services/product-matching.js';

async function step(title, fn) {
  try {
    const result = await fn();
    console.log(JSON.stringify({ step: title, ok: true, ...result }));
    return result;
  } catch (error) {
    console.error(JSON.stringify({ step: title, ok: false, error: error.message }));
    throw error;
  }
}

await step('sync-master', async () => {
  const pm = createProductMatchingService();
  return pm.syncMasterFromBenimpos();
});

await step('sync-costs', async () => {
  const benimpos = createBenimposService();
  return benimpos.syncCosts();
});

await step('sync-yemeksepeti-catalog', async () => {
  const pm = createProductMatchingService();
  return pm.syncYemeksepetiCatalogProducts();
});

await step('auto-match-yemeksepeti', async () => {
  const pm = createProductMatchingService();
  const match = await pm.runAutoMatch('yemeksepeti');
  const confirm = await pm.confirmAutoMatchedBulk({ channelId: 'yemeksepeti' });
  return { match, confirm };
});

console.log(JSON.stringify({ ok: true, finishedAt: new Date().toISOString() }));
