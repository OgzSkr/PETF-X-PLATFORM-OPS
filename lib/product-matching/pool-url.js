import { MARKETNEXT_INBOX, MARKETNEXT_MATCHING } from '../marketnext/constants.js';

export function buildProductPoolUrl(channelId = 'uber-eats', options = {}) {
  const params = new URLSearchParams();
  const tab = String(options.tab || channelId || 'master').trim();
  if (tab) params.set('tab', tab);

  const query = String(options.q || options.barcode || '').trim();
  if (query) params.set('q', query);

  const status = String(options.status || '').trim();
  if (status) params.set('status', status);

  const queueMode = String(options.queueMode || '').trim();
  if (queueMode) params.set('queueMode', queueMode);

  if (options.openMap) params.set('openMap', '1');

  const qs = params.toString();
  return qs ? `${MARKETNEXT_MATCHING}?${qs}` : MARKETNEXT_MATCHING;
}

export function productPoolUrlForMappingStatus(channelId, channelBarcode, mappingStatus) {
  const barcode = String(channelBarcode || '').trim();
  if (mappingStatus === 'missing_master') {
    return `${MARKETNEXT_INBOX}?channelId=${encodeURIComponent(channelId)}&queueMode=missing_master${barcode ? `&q=${encodeURIComponent(barcode)}` : ''}`;
  }
  if (mappingStatus === 'barcode_conflict') {
    return `${MARKETNEXT_MATCHING}?tab=conflicts`;
  }
  const params = new URLSearchParams({
    tab: channelId,
    openMap: '1'
  });
  if (barcode) params.set('q', barcode);
  if (mappingStatus && mappingStatus !== 'legacy') params.set('status', mappingStatus);
  return `${MARKETNEXT_MATCHING}?${params.toString()}`;
}
