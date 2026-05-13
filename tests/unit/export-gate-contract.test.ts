import test from 'node:test';
import assert from 'node:assert/strict';
import { validateExportRow } from '@/lib/oci/export-gate';
import { getConversionActionConfig, parseExportConfig } from '@/lib/oci/site-export-config';

test('validateExportRow: ok path includes 64-hex stableOrderId (adjustment SSOT)', () => {
  const cfg = parseExportConfig(null);
  const ac = getConversionActionConfig(cfg, 'phone', 'won');
  const r = validateExportRow(
    {
      id: 'row-1',
      gclid: 'gclid-fixture',
      value_cents: 100,
      signal_date: new Date('2026-05-05T12:00:00.000Z'),
    },
    cfg,
    ac
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.match(r.stableOrderId, /^[0-9a-f]{64}$/);
  }
});

test('validateExportRow: require_click_id fails closed without click or OCT', () => {
  const cfg = parseExportConfig(null);
  const ac = getConversionActionConfig(cfg, 'phone', 'won');
  const r = validateExportRow(
    {
      id: 'row-2',
      value_cents: 100,
      signal_date: new Date('2026-05-05T12:00:00.000Z'),
    },
    cfg,
    ac
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'NO_CLICK_ID');
});
