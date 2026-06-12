import { fetchOpsOrderPackages, mergeChannelOrderSources } from './ops-orders-bridge.js';

export { fetchOpsOrderPackages as fetchYemeksepetiOrdersFromOps } from './ops-orders-bridge.js';

/** Partner API + Ops Hub (YS webhook) siparişlerini birleştirir. */
export async function mergeYemeksepetiOrderSources(apiPackages, options = {}) {
  return mergeChannelOrderSources('yemeksepeti', apiPackages, options);
}
