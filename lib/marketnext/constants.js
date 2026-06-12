/**
 * MarketNext — hızlı market operasyon hattı (Getir, YS, TGO/Uber, BenimPOS).
 * Trendyol Pazaryeri ve WooCommerce bu ürün hattının dışındadır.
 */

export const PRODUCT_LINE = Object.freeze({
  MARKETNEXT: 'marketnext',
  MARKETPLACE: 'marketplace',
  ECOMMERCE: 'ecommerce'
});

/** Buybox/registry kanal kimlikleri — eşleştirme ve sipariş kârlılığı */
export const MARKETNEXT_BUYBOX_CHANNEL_IDS = Object.freeze([
  'uber-eats',
  'yemeksepeti',
  'getir'
]);

/** Ops Hub kanal kimlikleri (Postgres sipariş ingest) */
export const MARKETNEXT_OPS_CHANNEL_IDS = Object.freeze([
  'trendyol_go',
  'yemeksepeti',
  'getir'
]);

export const MARKETPLACE_CHANNEL_IDS = Object.freeze(['trendyol-marketplace']);
export const ECOMMERCE_CHANNEL_IDS = Object.freeze(['woocommerce']);

export const MARKETNEXT_BASE = '/marketnext';
export const MARKETNEXT_MATCHING = `${MARKETNEXT_BASE}/matching`;
export const MARKETNEXT_INBOX = `${MARKETNEXT_MATCHING}/inbox`;

const marketNextBuyboxSet = new Set(MARKETNEXT_BUYBOX_CHANNEL_IDS);
const marketplaceSet = new Set(MARKETPLACE_CHANNEL_IDS);
const ecommerceSet = new Set(ECOMMERCE_CHANNEL_IDS);

export function isMarketNextBuyboxChannel(channelId) {
  return marketNextBuyboxSet.has(String(channelId || '').trim());
}

export function isMarketNextOpsChannel(channelId) {
  return MARKETNEXT_OPS_CHANNEL_IDS.includes(String(channelId || '').trim());
}

export function isMarketplaceChannel(channelId) {
  return marketplaceSet.has(String(channelId || '').trim());
}

export function isEcommerceChannel(channelId) {
  return ecommerceSet.has(String(channelId || '').trim());
}

export function isExcludedFromMarketNext(channelId) {
  const id = String(channelId || '').trim();
  return isMarketplaceChannel(id) || isEcommerceChannel(id);
}

export function filterMarketNextBuyboxChannels(channelIds = []) {
  return channelIds.filter((id) => isMarketNextBuyboxChannel(id));
}
