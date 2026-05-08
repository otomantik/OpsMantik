/**
 * Shared cursor-aware canary export preview (markAsExported=false only).
 * PR-9H.3B / PR-9H.4A: journal orders QUEUED/RETRY by (updated_at, id); limit=1 may miss buildable rows.
 */

export function normalizeQueueIdFromItem(raw) {
  if (!raw?.id && raw?.id !== 0) return null;
  return String(raw.id).replace(/^seal_/, '');
}

/** Items use `conversionName` (camelCase); legacy readers may still see `conversion_name`. */
export function itemConversionName(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw.conversionName ?? raw.conversion_name ?? raw.action ?? null;
  return typeof v === 'string' ? v : v == null ? null : String(v);
}

export function resolveCanaryPreviewMaxPages() {
  const rawMaxPages = Number(
    process.env.PR9H_PREVIEW_MAX_PAGES || process.env.CANARY_PREVIEW_MAX_PAGES || '25'
  );
  return Number.isFinite(rawMaxPages) && rawMaxPages > 0
    ? Math.min(Math.floor(rawMaxPages), 60)
    : 25;
}

/**
 * Incoming cursor positions the NEXT fetch AFTER already-consumed journal rows for limit=1.
 * When preview matches expected row at page K, callers must replay that SAME incoming cursor
 * for mutating export (affirmative `markExported`), not preview response `next_cursor` (which skips past the matched row).
 *
 * @param {{
 *   baseUrl: string;
 *   siteId: string;
 *   expectedQueueId: string;
 *   headers: Record<string,string>;
 *   fetchFn?: typeof fetch;
 *   maxPages?: number;
 *   allowlistIdsCsv?: string;
 * }} opts
 */
export async function runCanaryJournalPreviewWalk(opts) {
  const {
    baseUrl,
    siteId,
    expectedQueueId,
    headers,
    fetchFn = fetch,
    maxPages = resolveCanaryPreviewMaxPages(),
    allowlistIdsCsv = '',
  } = opts;

  const base = baseUrl.replace(/\/+$/, '');
  /** @type {string | null} */
  let cursor = null;
  /** @type {string | null} */
  let matchedIncomingCursor = null;

  /** @param {string | null} incomingForThisRequest */
  async function fetchPreviewPage(incomingForThisRequest) {
    const qs =
      `?siteId=${encodeURIComponent(siteId)}` +
      '&providerKey=google_ads&markAsExported=false&limit=1&canaryMode=true' +
      (expectedQueueId
        ? `&canaryExpectedQueueId=${encodeURIComponent(expectedQueueId)}`
        : '') +
      (String(allowlistIdsCsv).trim()
        ? `&allowlistIds=${encodeURIComponent(String(allowlistIdsCsv).trim())}&allowlist_ids=${encodeURIComponent(String(allowlistIdsCsv).trim())}`
        : '') +
      (incomingForThisRequest
        ? `&cursor=${encodeURIComponent(incomingForThisRequest)}`
        : '');
    const url = `${base}/api/oci/google-ads-export${qs}`;
    const res = await fetchFn(url, { method: 'GET', headers });
    const body = await res.json().catch(() => ({}));
    const items = Array.isArray(body?.items) ? body.items : [];
    const item = items[0] ?? null;
    const nextCursor =
      typeof body?.next_cursor === 'string' ? body.next_cursor.trim() : '';

    return {
      res,
      body,
      item_count: items.length,
      item,
      preview_queue_id: normalizeQueueIdFromItem(item),
      conversion_name: itemConversionName(item),
      next_cursor: nextCursor || null,
      preview_diagnostics: body?.preview_diagnostics ?? null,
      incoming_cursor_used: Boolean(incomingForThisRequest),
    };
  }

  /** @type {Array<Record<string, unknown>>} */
  const pagination = [];
  /** @type {Awaited<ReturnType<typeof fetchPreviewPage>> | null} */
  let last = null;

  for (let page = 1; page <= maxPages; page++) {
    const incomingForThisPage = cursor;
    last = await fetchPreviewPage(incomingForThisPage);
    const diag = last.preview_diagnostics;

    pagination.push({
      page,
      incoming_cursor_present: Boolean(incomingForThisPage),
      incoming_cursor_truncated:
        incomingForThisPage?.length > 0
          ? `${String(incomingForThisPage).slice(0, 18)}…`
          : null,
      http_status: last.res.status,
      item_count: last.item_count,
      preview_queue_id: last.preview_queue_id,
      conversion_name: last.conversion_name,
      next_cursor_present: Boolean(last.next_cursor),
      diagnostics: diag
        ? {
            fetched_count: diag?.fetched_count ?? null,
            buildable_count: diag?.buildable_count ?? null,
            returned_count: diag?.returned_count ?? null,
            skipped_count: diag?.skipped_count ?? null,
            skip_reason_counts: diag?.skip_reason_counts ?? null,
          }
        : null,
    });

    const matchExpected =
      expectedQueueId &&
      last.preview_queue_id === expectedQueueId &&
      itemConversionName(last.item) === 'OpsMantik_Won' &&
      last.item_count === 1 &&
      last.res.ok;

    if (matchExpected) {
      matchedIncomingCursor = incomingForThisPage;
      break;
    }

    if (!last.next_cursor) break;
    cursor = last.next_cursor;
  }

  const terminal = pagination[pagination.length - 1];
  const foundGood =
    Boolean(expectedQueueId) &&
    last?.preview_queue_id === expectedQueueId &&
    itemConversionName(last?.item ?? null) === 'OpsMantik_Won' &&
    last?.item_count === 1 &&
    last?.res.ok;

  let diagnosis = 'AUTH_FIXED_BUT_PAYLOAD_EMPTY_UNKNOWN';
  let scopeDecision = 'CANARY_PREVIEW_BLOCKED_NO_BUILDABLE_ROWS';

  if (terminal && terminal.http_status === 401) {
    diagnosis = 'AUTH_CONTRACT_DRIFT';
    scopeDecision = 'CANARY_PREVIEW_HELPER_FIX_REQUIRED';
  } else if (foundGood) {
    diagnosis =
      pagination.length > 1 ? 'PREVIEW_WINDOW_CURSOR_REQUIRED' : 'FIRST_PREVIEW_PAGE_BUILD_OK';
    scopeDecision = 'CANARY_PREVIEW_READY';
  } else {
    const hitOther = pagination.find(
      (r) =>
        r.item_count === 1 &&
        r.preview_queue_id &&
        expectedQueueId &&
        r.preview_queue_id !== expectedQueueId
    );
    const anyItem = pagination.some((r) => r.item_count === 1);

    const lastHadNextCursor = Boolean(terminal?.next_cursor_present);
    const hitPageCapWithoutMatch = pagination.length >= maxPages;

    if (expectedQueueId && hitOther) {
      diagnosis = 'EXPECTED_QUEUE_ID_MISMATCH_ON_BUILDABLE_HIT';
      scopeDecision = 'CANARY_REQUIRES_NEW_EXPECTED_QUEUE_ID';
    } else if (!anyItem && lastHadNextCursor && hitPageCapWithoutMatch) {
      diagnosis = 'PREVIEW_WINDOW_CURSOR_REQUIRED';
      scopeDecision = 'CANARY_REQUIRES_CURSOR_WINDOW';
    } else if (!anyItem && lastHadNextCursor) {
      diagnosis = 'BUILD_GATE_DROPPED_ALL_ROWS_BEFORE_EXPECTED_CURSOR';
      scopeDecision = 'CANARY_REQUIRES_CURSOR_WINDOW';
    } else if (!anyItem) {
      diagnosis = 'NO_CURRENT_BUILDABLE_ROWS_IN_EXPLORED_WINDOW';
      scopeDecision = 'CANARY_PREVIEW_BLOCKED_NO_BUILDABLE_ROWS';
    }
  }

  /** Count pages where preview returned exactly one item (detect ambiguity vs expected). */
  const singleHitCount = pagination.filter(
    (row) =>
      typeof row.preview_queue_id === 'string' &&
      row.preview_queue_id === expectedQueueId &&
      row.item_count === 1
  ).length;

  return {
    foundGood,
    pagination,
    last,
    diagnosis,
    scopeDecision,
    maxPages,
    expectedQueueId,
    matchedIncomingCursor,
    singleHitPagesForExpected: singleHitCount,
    duplicatePreviewSingleAmbiguity:
      pagination.filter((row) => row.item_count === 1).length > 1,
    pagination_note:
      pagination.filter((row) => row.item_count === 1).length > 1
        ? 'multiple_preview_pages_returned_singleton_items'
        : null,
  };
}
