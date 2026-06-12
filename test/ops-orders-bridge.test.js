import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupeOrderPackages,
  packageFromYemeksepetiOpsRow,
  packageFromUberOpsRow
} from '../lib/channels/ops-orders-bridge.js';

test('dedupeOrderPackages keeps first occurrence by shipmentPackageId', () => {
  const rows = dedupeOrderPackages([
    { shipmentPackageId: 'a', orderNumber: '1' },
    { shipmentPackageId: 'a', orderNumber: '1-b' },
    { shipmentPackageId: 'b', orderNumber: '2' }
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].orderNumber, '1');
});

test('packageFromYemeksepetiOpsRow uses yemeksepetiOrder payload when present', () => {
  const pkg = packageFromYemeksepetiOpsRow({
    external_id: 'ys-1',
    display_id: 'YS-1',
    ingest_source: 'webhook',
    raw_payload: {
      yemeksepetiOrder: {
        order_id: 'ys-1',
        order_code: 'YS-1',
        status: 'RECEIVED',
        sys: { created_at: '2026-06-10T12:00:00Z' },
        items: [{
          sku: 'SKU1',
          barcode: ['8690001112223'],
          name: 'Test',
          pricing: { quantity: 1, unit_price: 40 }
        }]
      }
    },
    lines: []
  });
  assert.equal(pkg.shipmentPackageId, 'ys-1');
  assert.equal(pkg.ingestSource, 'webhook');
  assert.equal(pkg.lines[0].barcode, '8690001112223');
});

test('packageFromUberOpsRow builds profit lines from ops_order_lines json', () => {
  const pkg = packageFromUberOpsRow({
    external_id: 'pkg-99',
    display_id: '10654321001',
    channel_status: 'Picking',
    ordered_at: '2026-06-10T12:00:00Z',
    ingest_source: 'webhook',
    raw_payload: { grossAmount: 120 },
    lines: [{
      barcode: '8690637037428',
      title: 'Kedi Maması',
      quantity: 2,
      unit_price: 60,
      channel_product_id: 'sku-a'
    }]
  });
  assert.equal(pkg.shipmentPackageId, 'pkg-99');
  assert.equal(pkg.packageGrossAmount, 120);
  assert.equal(pkg.lines.length, 1);
  assert.equal(pkg.lines[0].productName, 'Kedi Maması');
});
