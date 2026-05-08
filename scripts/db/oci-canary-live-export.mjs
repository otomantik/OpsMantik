#!/usr/bin/env node
/**
 * PR-9E / PR-9H.4A canary live export wrapper (fail-closed).
 *
 * Pre-live: cursor-aware preview walk (`markAsExported=false` only), matching `pr9h-preview.mjs`.
 * Mutating live export (`markExported` affirmative query flag) requires explicit `--live` (PR-9H.4B+). Use `--dry-run` for parity checks only.
 */
import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import {
  runCanaryJournalPreviewWalk,
  resolveCanaryPreviewMaxPages,
} from './lib/oci-canary-preview-walk.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local'), override: false });

const REQUIRED_APPROVAL = 'I_APPROVE_PRODUCTION_CANARY';
const REQUIRED_REAPPROVAL = 'I_REAPPROVE_WITH_STUCK_PROCESSING_INCREASE';
const REQUIRED_CANARY_RISK_ACK = 'I_ACKNOWLEDGE_CANARY_SITE_RISK';
/** PR-9H.4D/E: mutating canary export requires this token (mirrors Apps Script gate). */
const REQUIRED_UPLOAD_APPROVAL = 'I_APPROVE_SINGLE_PAYLOAD_GOOGLE_UPLOAD';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const liveRun = argv.includes('--live');

function failBlocked(reason, extra = {}) {
  const payload = { ok: false, code: 'CANARY_EXPORT_BLOCKED', reason, ...extra };
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}

function readRequiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) failBlocked('MISSING_REQUIRED_ENV', { missing: name, classifier: 'CANARY_METADATA_MISSING' });
  return value;
}

function parseJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function parseSiteStuckProcessing(releaseEvidence, siteId) {
  const reports = Array.isArray(releaseEvidence?.checks)
    ? releaseEvidence.checks
        .filter((check) => check?.name === 'npm run smoke:oci-rollout-readiness:strict')
        .flatMap((check) => {
          try {
            const raw = String(check.output || '');
            const start = raw.indexOf('{');
            return [JSON.parse(raw.slice(start))];
          } catch {
            return [];
          }
        })
    : [];
  const reportRows = reports.flatMap((r) => (Array.isArray(r?.reports) ? r.reports : []));
  const found = reportRows.find((r) => r?.site?.id === siteId);
  return Number(found?.metrics?.stuckProcessing ?? 0);
}

function buildHeaders(meta, risk, allowlistIdsCsv) {
  const headers = {
    'x-api-key': meta.apiKey,
    'x-opsmantik-canary-mode': 'true',
    'x-opsmantik-change-ticket': meta.changeTicket,
    'x-opsmantik-operator-id': meta.operatorId,
    'x-opsmantik-canary-approval': meta.canaryApproval,
    'x-opsmantik-canary-site-id': meta.canarySiteId,
    'x-opsmantik-canary-max-batch-size': '1',
    'x-opsmantik-canary-expected-queue-id': meta.canaryExpectedQueueId,
  };
  if (risk.canaryRiskAck) headers['x-opsmantik-canary-risk-ack'] = risk.canaryRiskAck;
  if (risk.canaryReapproval) headers['x-opsmantik-canary-reapproval'] = risk.canaryReapproval;
  if (allowlistIdsCsv) headers['x-opsmantik-allowlist-ids'] = allowlistIdsCsv;
  return headers;
}

/** Single UUID, must equal expected canary queue id (PR-9H.4D). */
function parseAndAssertAllowlistIds(expectedQueueId, raw) {
  const csv = String(raw || '').trim();
  if (!csv) return { csv: '', ids: [] };
  const seen = new Set();
  for (const part of csv.split(',')) {
    const id = part.trim();
    if (!id) continue;
    seen.add(id);
  }
  const ids = [...seen];
  if (ids.length !== 1 || ids[0] !== expectedQueueId) {
    failBlocked('OPSMANTIK_ALLOWLIST_IDS_INVALID', {
      classifier: 'CANARY_ALLOWLIST_MISMATCH',
      expected_queue_id: expectedQueueId,
      allowlist_count: ids.length,
    });
  }
  return { csv, ids };
}

async function getJson(url, headers) {
  const res = await fetch(url, { method: 'GET', headers });
  let body = {};
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  if (!res.ok) {
    failBlocked('EXPORT_CALL_FAILED', { status: res.status, body });
  }
  return body;
}

function assertPreviewWalkGates(walk, meta) {
  const authFailure = walk.pagination.find((r) => r.http_status === 401 || r.http_status === 403);
  if (authFailure) {
    failBlocked('PREVIEW_HTTP_UNAUTHORIZED', {
      classifier: 'CANARY_PREVIEW_AUTH_FAILED',
      http_status: authFailure.http_status,
      page: authFailure.page,
    });
  }

  const badStatus = walk.pagination.find((r) => r.http_status !== 200);
  if (badStatus) {
    failBlocked('PREVIEW_HTTP_NON_OK', {
      classifier: 'CANARY_PREVIEW_BLOCKED',
      http_status: badStatus.http_status,
      page: badStatus.page,
    });
  }

  if (!walk.foundGood) {
    const reason =
      walk.scopeDecision === 'CANARY_REQUIRES_NEW_EXPECTED_QUEUE_ID'
        ? 'PREVIEW_EXPECTED_QUEUE_MISMATCH'
        : 'PREVIEW_GATE_FAILED';
    failBlocked(reason, {
      classifier:
        walk.diagnosis === 'PREVIEW_WINDOW_CURSOR_REQUIRED' && walk.pagination.length >= walk.maxPages
          ? 'CANARY_EXPECTED_QUEUE_ID_NOT_FOUND'
          : 'CANARY_PREVIEW_CURSOR_PARITY_FAILED',
      diagnosis: walk.diagnosis,
      scope_decision: walk.scopeDecision,
      pages_followed: walk.pagination.length,
      max_pages: walk.maxPages,
    });
  }

  if (walk.last?.item_count !== 1) {
    failBlocked('PREVIEW_NOT_SINGLE_ITEM', {
      classifier: 'CANARY_PREVIEW_BLOCKED',
      item_count: walk.last?.item_count ?? null,
    });
  }

  const qid = walk.last?.preview_queue_id;
  if (qid !== meta.canaryExpectedQueueId) {
    failBlocked('PREVIEW_EXPECTED_QUEUE_MISMATCH', {
      classifier: 'CANARY_EXPECTED_QUEUE_ID_NOT_FOUND',
      expected_queue_id: meta.canaryExpectedQueueId,
      preview_queue_id: qid || null,
    });
  }

  if (String(walk.last?.conversion_name || '') !== 'OpsMantik_Won') {
    failBlocked('PREVIEW_CONVERSION_MISMATCH', {
      classifier: 'CANARY_PREVIEW_BLOCKED',
      conversion_name: walk.last?.conversion_name ?? null,
    });
  }

  const unexpectedSingleton = walk.pagination.some(
    (r) =>
      r.item_count === 1 &&
      typeof r.preview_queue_id === 'string' &&
      r.preview_queue_id &&
      r.preview_queue_id !== meta.canaryExpectedQueueId
  );
  if (unexpectedSingleton) {
    failBlocked('PREVIEW_UNEXPECTED_SINGLETON_ROW', {
      classifier: 'CANARY_PREVIEW_BLOCKED',
      preview_allowlist_contract: walk.last?.body?.preview_diagnostics?.allowlist_contract ?? null,
    });
  }

  if (walk.duplicatePreviewSingleAmbiguity) {
    failBlocked('PREVIEW_DUPLICATE_SINGLETON_AMBIGUITY', { classifier: 'CANARY_PREVIEW_BLOCKED' });
  }
}

async function main() {
  if (dryRun === liveRun) {
    failBlocked('CLI_MODE_REQUIRED', {
      hint: 'Pass exactly one of --dry-run (preview only) or --live (mutating export; PR-9H.4B+).',
    });
  }

  const baseUrl = String(process.env.APP_BASE_URL || 'https://console.opsmantik.com').replace(/\/+$/, '');
  if (liveRun) {
    try {
      const { hostname } = new URL(baseUrl);
      const host = hostname.toLowerCase();
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
        failBlocked('LOCALHOST_LIVE_CANARY_FORBIDDEN', {
          classifier: 'PR9H4F_HOSTED_APP_BASE_URL_ONLY',
          hint: 'Mutating canary export (`--live`) must use hosted `APP_BASE_URL=https://console.opsmantik.com` — never localhost (PR-9H.4F).',
        });
      }
    } catch {
      failBlocked('INVALID_APP_BASE_URL', {});
    }
  }
  const meta = {
    changeTicket: readRequiredEnv('CHANGE_TICKET'),
    operatorId: readRequiredEnv('OPERATOR_ID'),
    canaryApproval: readRequiredEnv('CANARY_APPROVAL'),
    canarySiteId: readRequiredEnv('CANARY_SITE_ID'),
    canaryExpectedQueueId: readRequiredEnv('CANARY_EXPECTED_QUEUE_ID'),
    apiKey: readRequiredEnv('CANARY_API_KEY'),
  };

  if (meta.canaryApproval !== REQUIRED_APPROVAL) {
    failBlocked('INVALID_CANARY_APPROVAL');
  }

  const maxBatchRaw = readRequiredEnv('CANARY_MAX_BATCH_SIZE');
  if (maxBatchRaw !== '1') {
    failBlocked('CANARY_MAX_BATCH_SIZE_MUST_BE_1');
  }

  const precheckStuckRaw = readRequiredEnv('CANARY_PRECHECK_STUCK_PROCESSING');
  const precheckStuck = Number(precheckStuckRaw);
  if (!Number.isFinite(precheckStuck) || precheckStuck < 0) {
    failBlocked('INVALID_CANARY_PRECHECK_STUCK_PROCESSING');
  }

  const releaseEvidence = parseJsonSafe(join(process.cwd(), 'tmp', 'release-gates-production.json'));
  if (!releaseEvidence) {
    failBlocked('RELEASE_EVIDENCE_MISSING');
  }

  const currentStuck = parseSiteStuckProcessing(releaseEvidence, meta.canarySiteId);
  const stuckIncreased = currentStuck > precheckStuck;
  const canaryRiskAck = String(process.env.CANARY_RISK_ACK || '').trim();
  const canaryReapproval = String(process.env.CANARY_REAPPROVAL || '').trim();

  /** When set, send allowlist header on preview + live for server-side single-row fetch (PR-9H.4D). */
  let allowlistHeaderCsv = '';
  if (liveRun) {
    const uploadApproval = String(process.env.CANARY_UPLOAD_APPROVAL || '').trim();
    if (uploadApproval !== REQUIRED_UPLOAD_APPROVAL) {
      failBlocked('CANARY_UPLOAD_APPROVAL_INVALID', {
        classifier: 'CANARY_UPLOAD_APPROVAL_MISSING',
        hint: `Set CANARY_UPLOAD_APPROVAL=${REQUIRED_UPLOAD_APPROVAL}`,
      });
    }
    const parsed = parseAndAssertAllowlistIds(meta.canaryExpectedQueueId, process.env.OPSMANTIK_ALLOWLIST_IDS);
    allowlistHeaderCsv = parsed.csv;
  } else if (dryRun) {
    const rawAllow = String(process.env.OPSMANTIK_ALLOWLIST_IDS || '').trim();
    if (rawAllow) {
      const parsed = parseAndAssertAllowlistIds(meta.canaryExpectedQueueId, rawAllow);
      allowlistHeaderCsv = parsed.csv;
    }
  }

  if (currentStuck > 0 && canaryRiskAck !== REQUIRED_CANARY_RISK_ACK) {
    failBlocked('CANARY_RISK_ACK_REQUIRED', {
      current_stuck_processing: currentStuck,
      hint: `Set CANARY_RISK_ACK=${REQUIRED_CANARY_RISK_ACK}`,
    });
  }
  if (stuckIncreased && canaryReapproval !== REQUIRED_REAPPROVAL) {
    failBlocked('CANARY_REAPPROVAL_REQUIRED', {
      current_stuck_processing: currentStuck,
      precheck_stuck_processing: precheckStuck,
    });
  }

  const headers = buildHeaders(meta, { canaryRiskAck, canaryReapproval }, allowlistHeaderCsv);

  const walk = await runCanaryJournalPreviewWalk({
    baseUrl,
    siteId: meta.canarySiteId,
    expectedQueueId: meta.canaryExpectedQueueId,
    headers,
    maxPages: resolveCanaryPreviewMaxPages(),
    allowlistIdsCsv: allowlistHeaderCsv,
  });

  const allowContract = walk.last?.body?.preview_diagnostics?.allowlist_contract;
  if (String(allowlistHeaderCsv || '').trim() && allowContract && allowContract.applied_to_fetch === false) {
    failBlocked('EXPORT_FETCH_ALLOWLIST_FILTER_NOT_APPLIED', {
      classifier: 'EXPORT_FETCH_ALLOWLIST_FILTER_NOT_APPLIED',
      preview_allowlist_contract: allowContract,
    });
  }

  assertPreviewWalkGates(walk, meta);

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          code: 'CANARY_DRY_RUN_OK',
          mode: 'dry-run',
          markAsExported: false,
          claim: 'NOT_EXECUTED',
          allowlist_count: allowlistHeaderCsv ? 1 : 0,
          allowlist_id: allowlistHeaderCsv ? meta.canaryExpectedQueueId : null,
          pages_followed: walk.pagination.length,
          max_pages: walk.maxPages,
          preview_queue_id: walk.last?.preview_queue_id ?? null,
          preview_item_count: walk.last?.item_count ?? null,
          conversion_name: walk.last?.conversion_name ?? null,
          diagnosis: walk.diagnosis,
          scope_decision: walk.scopeDecision,
          matched_incoming_cursor_present: Boolean(walk.matchedIncomingCursor),
          preview_allowlist_contract: walk.last?.body?.preview_diagnostics?.allowlist_contract ?? null,
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  const allowlistQ = allowlistHeaderCsv
    ? `&allowlistIds=${encodeURIComponent(allowlistHeaderCsv)}&allowlist_ids=${encodeURIComponent(allowlistHeaderCsv)}`
    : '';
  const liveUrlBase = `${baseUrl}/api/oci/google-ads-export?siteId=${encodeURIComponent(meta.canarySiteId)}&providerKey=google_ads&markAsExported=true&limit=1&canaryMode=true&canaryExpectedQueueId=${encodeURIComponent(meta.canaryExpectedQueueId)}${allowlistQ}`;
  const liveUrl = walk.matchedIncomingCursor
    ? `${liveUrlBase}&cursor=${encodeURIComponent(walk.matchedIncomingCursor)}`
    : liveUrlBase;
  const live = await getJson(liveUrl, headers);
  const liveItems = Array.isArray(live?.items) ? live.items : [];
  if (liveItems.length !== 1) {
    failBlocked('LIVE_RESPONSE_NOT_SINGLE_ITEM', { live_count: liveItems.length });
  }
  const liveItem = liveItems[0];
  const liveQueueId = String(liveItem?.id || '').replace(/^seal_/, '');
  if (liveQueueId !== meta.canaryExpectedQueueId) {
    failBlocked('LIVE_EXPECTED_QUEUE_MISMATCH', {
      expected_queue_id: meta.canaryExpectedQueueId,
      live_queue_id: liveQueueId || null,
    });
  }

  const clickIdType = liveItem?.gclid
    ? 'gclid'
    : liveItem?.wbraid
      ? 'wbraid'
      : liveItem?.gbraid
        ? 'gbraid'
        : 'none';
  const diag = live?.live_diagnostics ?? null;
  /** value_cents from script item if whole currency unit is major (server sends conversionValue numeric). */
  const valueCentsFromItem =
    typeof liveItem?.conversionValue === 'number' && Number.isFinite(liveItem.conversionValue)
      ? Math.round(liveItem.conversionValue * 100)
      : null;

  console.log(
    JSON.stringify(
      {
        ok: true,
        code: 'CANARY_EXPORT_EXECUTED',
        response_status: 200,
        export_run_id: live?.export_run_id || null,
        queue_id: liveQueueId,
        preview_export_run_id: walk.last?.body?.export_run_id || null,
        matched_incoming_cursor_present: Boolean(walk.matchedIncomingCursor),
        allowlist_count: 1,
        canary_upload_approval_gate: true,
        live_diagnostics: diag,
        item_snapshot_redacted: {
          claimed_queue_id: liveQueueId,
          conversion_name: liveItem?.conversionName ?? null,
          order_id_length: liveItem?.orderId != null ? String(liveItem.orderId).length : 0,
          click_id_type: clickIdType,
          conversion_value: liveItem?.conversionValue ?? null,
          conversion_currency: liveItem?.conversionCurrency ?? null,
          value_cents_inferred_from_item: valueCentsFromItem,
        },
        upload_path_note:
          'HTTP export returns payload only; Google upload + /api/oci/ack paths are out-of-band (script/worker).',
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  failBlocked('UNHANDLED_EXCEPTION', { message: error instanceof Error ? error.message : String(error) });
});
