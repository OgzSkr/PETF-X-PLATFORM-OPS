#!/usr/bin/env node
/**
 * Tüm kanal listelerinde barkod eşleşmesi ile otomatik eşleştir + onayla.
 *
 *   node scripts/ops-auto-match-all-channels.js
 *   node scripts/ops-auto-match-all-channels.js --no-confirm
 */
import { createProductMatchingService } from '../lib/platform/services/product-matching.js';

const confirm = !process.argv.includes('--no-confirm');
const pm = createProductMatchingService();
const result = await pm.runAutoMatchAllChannels({ confirm });

for (const row of result.channels) {
  const m = row.match;
  const c = row.confirm;
  console.log(
    `${row.channelId}: scanned=${m.scanned} auto=${m.autoMatched} review=${m.reviewRequired} missing=${m.missingMaster}` +
      (c ? ` confirmed=${c.confirmed}` : '')
  );
}

console.log('\nBarkod eşleşen tüm kanallar işlendi.');
