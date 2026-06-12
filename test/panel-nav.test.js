import test from 'node:test';
import assert from 'node:assert/strict';
import { PANEL_MODULES, findNavItemByPath } from '../lib/panel/nav-config.js';
import { redirectOpsLegacy } from '../lib/platform/routes/panel-routes.js';
import {
  isExcludedFromMarketNext,
  isMarketNextBuyboxChannel,
  MARKETNEXT_BUYBOX_CHANNEL_IDS
} from '../lib/marketnext/constants.js';
import { listMarketNextMatchingSalesChannels } from '../lib/channels/registry.js';

test('panel modules define MarketNext, marketplace, ecommerce and admin', () => {
  assert.ok(PANEL_MODULES.marketnext);
  assert.ok(PANEL_MODULES.marketplace);
  assert.ok(PANEL_MODULES.ecommerce);
  assert.ok(PANEL_MODULES.admin);
  assert.equal(PANEL_MODULES.marketnext.items.find((i) => i.id === 'matching')?.href, '/marketnext/matching');
  assert.equal(PANEL_MODULES.marketnext.items.find((i) => i.id === 'picking')?.href, '/marketnext/picking');
  assert.equal(PANEL_MODULES.ecommerce.items[0].href, '/ecommerce/woocommerce');
});

test('findNavItemByPath resolves legacy alias paths to MarketNext', () => {
  const hit = findNavItemByPath('/urun-havuzu');
  assert.equal(hit?.item.id, 'masters');
  assert.equal(hit?.module.id, 'marketnext');
  const urunler = findNavItemByPath('/urunler');
  assert.equal(urunler?.item.id, 'products');
  assert.equal(urunler?.module.id, 'marketplace');
  const uber = findNavItemByPath('/uber-eats');
  assert.equal(uber?.module.id, 'marketnext');
  const woo = findNavItemByPath('/woocommerce');
  assert.equal(woo?.module.id, 'ecommerce');
});

test('redirectOpsLegacy maps /ops to marketnext picking', () => {
  assert.equal(redirectOpsLegacy('/ops/', new URLSearchParams()), '/marketnext/picking/');
});

test('MarketNext channel separation excludes marketplace and woocommerce matching', () => {
  for (const id of MARKETNEXT_BUYBOX_CHANNEL_IDS) {
    assert.ok(isMarketNextBuyboxChannel(id));
    assert.ok(!isExcludedFromMarketNext(id));
  }
  assert.ok(isExcludedFromMarketNext('trendyol-marketplace'));
  assert.ok(isExcludedFromMarketNext('woocommerce'));
  const matchingIds = listMarketNextMatchingSalesChannels().map((c) => c.id);
  assert.ok(matchingIds.includes('uber-eats'));
  assert.ok(matchingIds.includes('yemeksepeti'));
  assert.ok(!matchingIds.includes('woocommerce'));
  assert.ok(!matchingIds.includes('trendyol-marketplace'));
});
