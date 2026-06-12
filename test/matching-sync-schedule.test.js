import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMatchingSyncSettings,
  DEFAULT_MATCHING_SYNC_CHANNELS
} from '../lib/product-matching/matching-sync-schedule.js';

test('default sync channels are MarketNext only', () => {
  assert.ok(DEFAULT_MATCHING_SYNC_CHANNELS.includes('yemeksepeti'));
  assert.ok(DEFAULT_MATCHING_SYNC_CHANNELS.includes('uber-eats'));
  assert.ok(!DEFAULT_MATCHING_SYNC_CHANNELS.includes('woocommerce'));
  assert.ok(!DEFAULT_MATCHING_SYNC_CHANNELS.includes('trendyol-marketplace'));
});

test('normalizeMatchingSyncSettings drops non-MarketNext channels', () => {
  const settings = normalizeMatchingSyncSettings({
    channels: ['yemeksepeti', 'woocommerce', 'trendyol-marketplace', 'uber-eats']
  });
  assert.deepEqual(settings.channels, ['yemeksepeti', 'uber-eats']);
});
