import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPreviewDiagnosticsExtension } from '@/app/api/oci/google-ads-export/export-preview-diagnostics';
import type { QueueRow } from '@/lib/oci/google-ads-export/types';

const emptyPipeline = {
  fetch_row_count: 1,
  build_queue_conversions_count: 0,
  after_call_sendability_filter_count: 0,
  after_highest_gear_returned_count: 0,
} as const;

const emptyPhone = {
  hashed_phone_available_count: 0,
  hashed_phone_invalid_count: 0,
  enhanced_signal_available_count: 0,
  hashed_phone_candidate_count: 0,
  hashed_phone_exported_count: 0,
  hashed_phone_missing_count: 0,
  hashed_phone_source_counts: {},
} as const;

const emptyCurrency = {
  currency_missing_count: 0,
  currency_unexpected_count: 0,
  currency_defaulted_count: 0,
} as const;

test('preview skip_by_reason_detail splits export gate: missing call vs no click id', () => {
  const raw: QueueRow[] = [
    {
      id: 'q-miss',
      call_id: null,
      conversion_time: '2026-05-05T10:00:00.000Z',
      value_cents: 100,
      action: 'OpsMantik_Won',
    } as QueueRow,
    {
      id: 'q-nc',
      call_id: 'c1',
      conversion_time: '2026-05-05T10:00:00.000Z',
      value_cents: 100,
      action: 'OpsMantik_Won',
      gclid: null,
      wbraid: null,
      gbraid: null,
    } as QueueRow,
  ];

  const ext = buildPreviewDiagnosticsExtension(
    raw,
    {
      suppressedQueueIds: [],
      blockedQueueTimeIds: [],
      blockedValueZeroIds: [],
      blockedExpiredIds: [],
      blockedExportGateIds: ['q-miss', 'q-nc'],
      blockedExportGateReasonByQueueId: {
        'q-miss': 'MISSING_CALL_ID',
        'q-nc': 'NO_CLICK_ID',
      },
      blockedMissingConversionActionIds: [],
      combined: [],
    },
    emptyPipeline,
    [],
    emptyPhone,
    emptyCurrency
  );

  assert.deepEqual(ext.skip_by_reason_detail, {
    export_gate_missing_call_id: 1,
    export_gate_no_click_id: 1,
  });
});
