import { mergeChannelOrderSources } from './ops-orders-bridge.js';

/** Partner API + Ops Hub (TGO poll/webhook) siparişlerini birleştirir. */
export async function mergeUberEatsOrderSources(apiPackages, options = {}) {
  return mergeChannelOrderSources('uber-eats', apiPackages, options);
}

export { fetchOpsOrderPackages as fetchUberEatsOrdersFromOps } from './ops-orders-bridge.js';
