/**
 * OpsMantik Google Ads OCI — Universal Script (Kemik)
 *
 * Paste into Google Ads Script Editor → entry: `main`
 * Runtime: Chrome V8 ON
 *
 * ┌──────────────────────────────────────────────────────┐
 * │  HER SİTE İÇİN SADECE AŞAĞIDAKİ 2 SATIRI DEĞİŞTİR │
 * │  SITE_ID  →  OpsMantik konsolundan sitenin public_id │
 * │  API_KEY  →  OpsMantik konsolundan sitenin OCI key'i │
 * └──────────────────────────────────────────────────────┘
 *
 * Canonical production fleet script (not in fleet-quarantine.json).
 * Site-specific forks are quarantined; customization is config / Script Properties — not new forks — unless explicitly approved.
 */

'use strict';

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  SİTE AYARLARI — Her Google Ads hesabı için bunları değiştirin      ║
// ╚══════════════════════════════════════════════════════════════════════╝

/** @type {string} Site public_id — OpsMantik konsolundan alınır (zorunlu) */
var SITE_ID = '';

/** @type {string} OCI API key — OpsMantik konsolundan alınır (zorunlu) */
var API_KEY = '';

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  GENEL AYARLAR — Normalde değiştirmenize gerek yok                  ║
// ╚══════════════════════════════════════════════════════════════════════╝

/** API base URL */
var BASE_URL = 'https://console.opsmantik.com';

/** sync = dönüşüm gönder, peek = sadece kuyruğa bak (upload yok) */
var RUN_MODE = 'sync';

/** Sayfa başı satır limiti (max 1000) */
var EXPORT_LIMIT = '50';

/** Bir çalışmada max sayfa sayısı */
var MAX_PAGES = '10';

/** Google'ın 30dk duvarından önce dur (ms, default ~25dk) */
var MAX_RUNTIME_MS = '1500000';

/** Hashed telefon sütunu eklensin mi? (true/false) */
var INCLUDE_HASHED_PHONE = 'true';

/** Google Bulk Upload CSV'deki tam sütun başlığı */
var HASHED_PHONE_COLUMN = 'Hashed Phone Number';

// ═══════════════════════════════════════════════════════════════════════
//  BURADAN AŞAĞISINA DOKUNMAYIN — Universal motor kodu
// ═══════════════════════════════════════════════════════════════════════

var DEFAULT_MAX_PAGES = 10;
var DEFAULT_MAX_RUNTIME_MS = 1500000;
var DEFAULT_EXPORT_LIMIT = 50;

function loadConfig() {
  // Inline değerler öncelikli, Script Properties fallback
  function getVal(inlineVal, propKey, fallback) {
    // 1. Inline (scriptin başındaki değişkenler)
    if (typeof inlineVal === 'string' && inlineVal.trim()) return inlineVal.trim();
    // 2. Script Properties (varsa)
    try {
      var props = PropertiesService.getScriptProperties();
      var pv = props.getProperty(propKey);
      if (pv != null && String(pv).trim()) return String(pv).trim();
    } catch (e) { /* ignore */ }
    // 3. Fallback
    return fallback || '';
  }

  var siteId = getVal(SITE_ID, 'OPSMANTIK_SITE_ID', '');
  var apiKey = getVal(API_KEY, 'OPSMANTIK_API_KEY', '');
  var baseUrl = getVal(BASE_URL, 'OPSMANTIK_BASE_URL', 'https://console.opsmantik.com');
  var runMode = getVal(RUN_MODE, 'OPSMANTIK_RUN_MODE', 'sync');

  var limitRaw = parseInt(getVal(EXPORT_LIMIT, 'OPSMANTIK_EXPORT_LIMIT', String(DEFAULT_EXPORT_LIMIT)), 10);
  var limit = (limitRaw > 0 && limitRaw <= 1000) ? limitRaw : DEFAULT_EXPORT_LIMIT;

  var maxPagesRaw = parseInt(getVal(MAX_PAGES, 'OPSMANTIK_MAX_PAGES', String(DEFAULT_MAX_PAGES)), 10);
  var maxPages = (maxPagesRaw > 0 && maxPagesRaw <= 500) ? maxPagesRaw : DEFAULT_MAX_PAGES;

  var maxRuntimeRaw = parseInt(getVal(MAX_RUNTIME_MS, 'OPSMANTIK_MAX_RUNTIME_MS', String(DEFAULT_MAX_RUNTIME_MS)), 10);
  var maxRuntime = (maxRuntimeRaw >= 120000 && maxRuntimeRaw <= 1790000) ? maxRuntimeRaw : DEFAULT_MAX_RUNTIME_MS;

  var includeHp = /^true$/i.test(getVal(INCLUDE_HASHED_PHONE, 'OPSMANTIK_INCLUDE_HASHED_PHONE', ''));
  var hpColumn = getVal(HASHED_PHONE_COLUMN, 'OPSMANTIK_HASHED_PHONE_COLUMN', '');

  return Object.freeze({
    SITE_ID:    siteId,
    API_KEY:    apiKey,
    BASE_URL:   baseUrl,
    RUN_MODE:   runMode.toLowerCase() === 'peek' ? 'peek' : 'sync',
    LIMIT:      limit,
    MAX_PAGES:  maxPages,
    MAX_RUNTIME_MS: maxRuntime,
    INCLUDE_HP: includeHp,
    HP_COLUMN:  hpColumn,
  });
}

// ─── Telemetry ───────────────────────────────────────────────────────────────

var Log = {
  info:  function(m, d) { Logger.log('[INFO] ' + m + (d ? ' | ' + JSON.stringify(d) : '')); },
  warn:  function(m, d) { Logger.log('[WARN] ' + m + (d ? ' | ' + JSON.stringify(d) : '')); },
  error: function(m, e) { Logger.log('[ERROR] ' + m + ' | ' + (e && e.message ? e.message : String(e || ''))); },
};

// ─── Conversion Events (must match Google Ads UI exactly) ────────────────────

var EVENTS = Object.freeze({
  CONTACTED:      'OpsMantik_Contacted',
  OFFERED:        'OpsMantik_Offered',
  WON:            'OpsMantik_Won',
  JUNK_EXCLUSION: 'OpsMantik_Junk_Exclusion',
});

// ─── Validators & Helpers ────────────────────────────────────────────────────

function nowMs() { return new Date().getTime(); }

/** Validate Google Ads time format: YYYYMMDD HHMMSS or ISO-ish with tz offset. */
function isValidTime(s) {
  if (!s || typeof s !== 'string') return false;
  s = s.trim();
  if (/^\d{8} \d{6}$/.test(s)) return true;
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{2}:?\d{2}$/.test(s);
}

/** Normalize time: remove colon from tz offset if present. */
function normalizeTime(s) {
  if (!s) return '';
  s = s.trim();
  if (/^\d{8} \d{6}$/.test(s)) return s;
  return s.replace(/([+-]\d{2}):(\d{2})$/, '$1$2');
}

/**
 * Locale-safe value parser (Tintebaat fix #3).
 * Handles: "1.500,75" (TR/EU) → 1500.75, "1,500.75" (US) → 1500.75, "1500.75" → 1500.75
 * Backend SHOULD send standard float, but this is a safety net.
 */
function parseConversionValue(raw) {
  var s = String(raw == null ? 0 : raw).replace(/[^\d.,-]/g, '').trim();
  if (!s) return 0;
  var lastDot = s.lastIndexOf('.');
  var lastComma = s.lastIndexOf(',');
  if (lastComma > lastDot) {
    // European: 1.500,75 → remove dots, replace comma with dot
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma && lastComma >= 0) {
    // US: 1,500.75 → remove commas
    s = s.replace(/,/g, '');
  }
  // else: no comma or simple float like 1500.75
  var v = parseFloat(s);
  return (isFinite(v) && v >= 0) ? v : 0;
}

/** Click-ID priority: gclid > wbraid > gbraid. Exactly one per CSV row. */
function resolveClickId(row) {
  var g = (row.gclid || '').trim();
  var w = (row.wbraid || '').trim();
  var b = (row.gbraid || '').trim();
  if (g) return { type: 'gclid', value: g };
  if (w) return { type: 'wbraid', value: w };
  if (b) return { type: 'gbraid', value: b };
  return null;
}

/** Extract server-prehashed phone (64-char hex SHA-256). Never hash in script. */
function extractHashedPhone(row) {
  if (!row || typeof row !== 'object') return '';
  var candidates = [];
  if (typeof row.hashedPhoneNumber === 'string') candidates.push(row.hashedPhoneNumber.trim().toLowerCase());
  if (typeof row.hashed_phone_number === 'string') candidates.push(row.hashed_phone_number.trim().toLowerCase());
  var list = row.userIdentifiers || row.user_identifiers;
  if (list && list.length) {
    for (var i = 0; i < list.length; i++) {
      var e = list[i] || {};
      if (String(e.type || '').toLowerCase() === 'hashed_phone' && e.value) {
        candidates.push(String(e.value).trim().toLowerCase());
      }
    }
  }
  for (var j = 0; j < candidates.length; j++) {
    if (/^[a-f0-9]{64}$/.test(candidates[j])) return candidates[j];
  }
  return '';
}

// ─── HTTP Client ─────────────────────────────────────────────────────────────

function OciClient(baseUrl, apiKey) {
  this.baseUrl = baseUrl.replace(/\/+$/, '');
  this.apiKey = apiKey;
  this.token = null;
  this.siteId = null;
}

OciClient.prototype._fetch = function(url, opts) {
  var attempt = 0, delay = 1500, maxRetries = 4;
  while (attempt <= maxRetries) {
    try {
      var resp = UrlFetchApp.fetch(url, Object.assign({}, opts, { muteHttpExceptions: true }));
      var code = resp.getResponseCode();
      if (code >= 200 && code < 300) return resp;
      var body = resp.getContentText() || '';
      if (code === 429 || code >= 500) {
        Log.warn('Retryable HTTP ' + code, { attempt: attempt + 1, url: url });
      } else {
        throw new Error('HTTP ' + code + ': ' + body.slice(0, 300));
      }
    } catch (err) {
      if (attempt >= maxRetries) throw err;
      Log.warn('Network retry', { attempt: attempt + 1 });
    }
    attempt++;
    Utilities.sleep(delay + Math.floor(Math.random() * 500));
    delay *= 2;
  }
  throw new Error('Max retries: ' + url);
};

OciClient.prototype._sign = function(payload) {
  if (!payload || !this.apiKey) return '';
  try {
    var sig = Utilities.computeHmacSha256Signature(payload, this.apiKey);
    var hex = '';
    for (var i = 0; i < sig.length; i++) {
      var v = sig[i]; if (v < 0) v += 256;
      var h = v.toString(16); if (h.length === 1) h = '0' + h;
      hex += h;
    }
    return hex;
  } catch (e) { return ''; }
};

OciClient.prototype._authFetch = function(url, opts) {
  try { return this._fetch(url, opts); }
  catch (err) {
    if (String(err.message || '').indexOf('HTTP 401') < 0 || !this.siteId) throw err;
    Log.warn('Token expired, renewing');
    this.handshake(this.siteId);
    var h = Object.assign({}, opts.headers || {});
    h.Authorization = 'Bearer ' + this.token;
    if (h['x-oci-signature'] && opts.payload) h['x-oci-signature'] = this._sign(opts.payload);
    return this._fetch(url, Object.assign({}, opts, { headers: h }));
  }
};

OciClient.prototype.handshake = function(siteId) {
  this.siteId = siteId;
  var resp = this._fetch(this.baseUrl + '/api/oci/v2/verify', {
    method: 'post',
    headers: { 'x-api-key': this.apiKey, 'Content-Type': 'application/json' },
    payload: JSON.stringify({ siteId: siteId }),
  });
  var data = JSON.parse(resp.getContentText() || '{}');
  if (!data.session_token) throw new Error('Handshake failed');
  this.token = data.session_token;
};

OciClient.prototype.fetchPage = function(siteId, cursor, markAsExported, limit) {
  var lim = limit || DEFAULT_EXPORT_LIMIT;
  var url = this.baseUrl + '/api/oci/google-ads-export?siteId=' + encodeURIComponent(siteId)
    + '&markAsExported=' + (markAsExported ? 'true' : 'false')
    + '&providerKey=google_ads'
    + '&limit=' + encodeURIComponent(String(lim));
  if (cursor) url += '&cursor=' + encodeURIComponent(cursor);

  var headers = {
    Authorization: 'Bearer ' + this.token,
    Accept: 'application/json',
    'Cache-Control': 'no-store',
  };

  // Broad drain headers (required for mutating export)
  if (markAsExported) {
    headers['x-opsmantik-drain-approval'] = 'I_APPROVE_SCRIPT_DRAIN';
    headers['x-opsmantik-drain-site-id'] = String(siteId);
    headers['x-opsmantik-drain-max-batch-size'] = String(lim);
    headers['x-opsmantik-drain-include-braids'] = 'true';
  }

  var resp;
  try {
    resp = this._authFetch(url, { method: 'get', headers: headers });
  } catch (err) {
    if (String(err.message || '').indexOf('QUEUE_CLAIM_MISMATCH') >= 0) {
      Log.warn('Queue claim mismatch — another script holds claim');
      return { items: [], nextCursor: null, hasNextPage: false, exportRunId: null };
    }
    throw err;
  }

  var p = JSON.parse(resp.getContentText() || '{}');
  var items = Array.isArray(p) ? p : (p.data || p.items || []);
  return {
    items: items,
    nextCursor: (p.meta && p.meta.nextCursor) || p.next_cursor || null,
    hasNextPage: (p.meta && p.meta.hasNextPage === true) || !!(p.next_cursor),
    exportRunId: p.export_run_id || null,
    counts: p.counts || null,
    diagnostics: p.preview_diagnostics || null,
  };
};

OciClient.prototype.sendAck = function(siteId, queueIds, skippedIds, exportRunId) {
  if (!queueIds.length && !(skippedIds || []).length) return null;
  var payload = {
    siteId: siteId,
    queueIds: queueIds,
    pendingConfirmation: true,
    providerConfirmationMode: 'bulk_upload_async_unconfirmed',
  };
  if (exportRunId) { payload.exportRunId = exportRunId; payload.export_run_id = exportRunId; }
  if (skippedIds && skippedIds.length) payload.skippedIds = skippedIds;
  var body = JSON.stringify(payload);
  var resp = this._authFetch(this.baseUrl + '/api/oci/ack', {
    method: 'post',
    headers: {
      Authorization: 'Bearer ' + this.token,
      'Content-Type': 'application/json',
      'x-oci-signature': this._sign(body),
    },
    payload: body,
  });
  try { return JSON.parse(resp.getContentText() || '{}'); } catch (e) { return { ok: false }; }
};

OciClient.prototype.sendAckFailed = function(siteId, queueIds, code, message, category, exportRunId) {
  if (!queueIds || !queueIds.length) return null;
  var body = JSON.stringify({
    siteId: siteId, queueIds: queueIds,
    errorCode: code || 'UNKNOWN', errorMessage: message || code,
    errorCategory: category || 'TRANSIENT',
    exportRunId: exportRunId || undefined,
    export_run_id: exportRunId || undefined,
  });
  var resp = this._authFetch(this.baseUrl + '/api/oci/ack-failed', {
    method: 'post',
    headers: {
      Authorization: 'Bearer ' + this.token,
      'Content-Type': 'application/json',
      'x-oci-signature': this._sign(body),
    },
    payload: body,
  });
  try { return JSON.parse(resp.getContentText() || '{}'); } catch (e) { return { ok: true }; }
};

// ─── PEEK Mode ───────────────────────────────────────────────────────────────

function runPeek(cfg, client) {
  Log.info('PEEK — queue preview (no upload, no claim)');
  var cursor = null, pageNo = 0, total = 0, start = nowMs();

  while (pageNo < cfg.MAX_PAGES) {
    if (nowMs() - start >= cfg.MAX_RUNTIME_MS) { Log.warn('PEEK timeout'); break; }
    pageNo++;
    var page = client.fetchPage(cfg.SITE_ID, cursor, false, cfg.LIMIT);
    var rows = page.items || [];
    total += rows.length;

    Log.info('PEEK page ' + pageNo, {
      rows: rows.length, counts: page.counts,
      diagnostics_keys: page.diagnostics ? Object.keys(page.diagnostics) : null,
    });

    // Log first 20 rows (booleans only — no PII)
    for (var i = 0; i < Math.min(rows.length, 20); i++) {
      var r = rows[i];
      var cid = resolveClickId(r);
      Logger.log('[PEEK] action=' + (r.conversionName || '') +
        ' value=' + (r.conversionValue != null ? r.conversionValue : '') +
        ' currency=' + (r.conversionCurrency || 'TRY') +
        ' g=' + (r.gclid ? '1' : '0') +
        ' w=' + (r.wbraid ? '1' : '0') +
        ' gb=' + (r.gbraid ? '1' : '0') +
        ' hp=' + (extractHashedPhone(r) ? '1' : '0') +
        ' valid_time=' + (isValidTime(r.conversionTime) ? '1' : '0'));
    }

    cursor = page.nextCursor;
    if (!page.hasNextPage || !cursor) break;
  }
  Log.info('PEEK done', { pages: pageNo, totalRows: total });
}

// ─── SYNC Mode (Tintebaat fix: single bulk upload) ───────────────────────────

function runSync(cfg, client) {
  Log.info('SYNC — upload + ACK');
  var cursor = null, pageNo = 0, start = nowMs();
  var exportRunId = null;

  // ── Phase 1: Fetch all pages, accumulate rows ──
  var allRows = [];

  while (pageNo < cfg.MAX_PAGES) {
    if (nowMs() - start >= cfg.MAX_RUNTIME_MS) {
      Log.warn('SYNC fetch timeout', { pages: pageNo });
      break;
    }
    pageNo++;
    var page = client.fetchPage(cfg.SITE_ID, cursor, true, cfg.LIMIT);  // claim rows
    var rows = page.items || [];

    if (page.exportRunId && !exportRunId) exportRunId = page.exportRunId;
    if (!rows.length) break;

    for (var i = 0; i < rows.length; i++) allRows.push(rows[i]);
    Log.info('Fetched page ' + pageNo, { rows: rows.length, cumulative: allRows.length });

    cursor = page.nextCursor;
    if (!page.hasNextPage || !cursor) break;
  }

  if (!allRows.length) {
    Log.info('SYNC: queue empty, nothing to upload');
    return;
  }

  // ── Phase 2: Build single CSV and upload (Tintebaat fix #1) ──
  var timezone = AdsApp.currentAccount().getTimeZone() || 'UTC';
  var headers = ['Order ID', 'Google Click ID', 'WBRAID', 'GBRAID',
    'Conversion name', 'Conversion time', 'Conversion value', 'Conversion currency'];
  if (cfg.INCLUDE_HP && cfg.HP_COLUMN) headers.push(cfg.HP_COLUMN);

  var upload = AdsApp.bulkUploads().newCsvUpload(headers, { moneyInMicros: false, timeZone: timezone });
  upload.forOfflineConversions();
  upload.setFileName('OpsMantik_OCI_' + new Date().toISOString().replace(/[:.]/g, '-') + '.csv');

  var successIds = [], failedRows = [], skippedIds = [];
  var stats = { uploaded: 0, gclid: 0, wbraid: 0, gbraid: 0, hp: 0 };

  for (var ri = 0; ri < allRows.length; ri++) {
    var row = allRows[ri];

    // Validate click ID
    var cid = resolveClickId(row);
    if (!cid) {
      var hp = extractHashedPhone(row);
      failedRows.push({ id: row.id, code: hp ? 'HASHED_PHONE_ONLY_UNSUPPORTED' : 'MISSING_CLICK_ID' });
      continue;
    }

    // Validate time
    if (!isValidTime(row.conversionTime)) {
      failedRows.push({ id: row.id, code: 'INVALID_TIME' });
      continue;
    }

    // Timezone guard (Tintebaat fix #5): warn if no offset
    if (row.conversionTime && !/[+-]\d{2}:?\d{2}$/.test(row.conversionTime.trim())
        && !/^\d{8} \d{6}$/.test(row.conversionTime.trim())) {
      Log.warn('TIME_NO_OFFSET', { row_id: row.id ? '...' + String(row.id).slice(-6) : '?' });
    }

    var orderId = String(row.orderId || row.id || '').slice(0, 64);
    if (!orderId) {
      failedRows.push({ id: row.id, code: 'MISSING_ORDER_ID' });
      continue;
    }

    // Build CSV row
    var csvRow = {};
    csvRow['Order ID'] = orderId;
    csvRow['Google Click ID'] = cid.type === 'gclid' ? cid.value : '';
    csvRow['WBRAID'] = cid.type === 'wbraid' ? cid.value : '';
    csvRow['GBRAID'] = cid.type === 'gbraid' ? cid.value : '';
    csvRow['Conversion name'] = (row.conversionName || '').trim() || EVENTS.WON;
    csvRow['Conversion time'] = normalizeTime(row.conversionTime);
    csvRow['Conversion value'] = parseConversionValue(row.conversionValue);
    csvRow['Conversion currency'] = (row.conversionCurrency || 'TRY').toUpperCase();

    if (cfg.INCLUDE_HP && cfg.HP_COLUMN) {
      var hpVal = extractHashedPhone(row);
      csvRow[cfg.HP_COLUMN] = hpVal || '';
      if (hpVal) stats.hp++;
    }

    upload.append(csvRow);
    stats.uploaded++;
    if (cid.type === 'gclid') stats.gclid++;
    else if (cid.type === 'wbraid') stats.wbraid++;
    else if (cid.type === 'gbraid') stats.gbraid++;
    if (row.id) successIds.push(row.id);
  }

  Log.info('CSV built', {
    total_rows: allRows.length, uploadable: stats.uploaded, failed: failedRows.length,
    gclid: stats.gclid, wbraid: stats.wbraid, gbraid: stats.gbraid, hp: stats.hp,
  });

  // ── Phase 3: Send failed validations to ACK_FAILED ──
  for (var fi = 0; fi < failedRows.length; fi++) {
    var f = failedRows[fi];
    if (f.id) {
      try {
        client.sendAckFailed(cfg.SITE_ID, [f.id], f.code, f.code, 'VALIDATION', exportRunId);
      } catch (e) { Log.warn('ack-failed dispatch error', { code: f.code }); }
    }
  }

  if (stats.uploaded === 0) {
    Log.warn('SYNC: no uploadable rows after validation');
    return;
  }

  // ── Phase 4: Single upload.apply() (Tintebaat fix #1) ──
  var uploadOk = false;
  try {
    upload.apply();
    uploadOk = true;
    Log.info('upload.apply() succeeded', { rows: stats.uploaded });
  } catch (err) {
    Log.error('upload.apply() FAILED', err);
    // ACK_FAILED for all attempted rows
    if (successIds.length) {
      try {
        client.sendAckFailed(cfg.SITE_ID, successIds,
          'UPLOAD_EXCEPTION', String(err.message || err).slice(0, 500), 'TRANSIENT', exportRunId);
      } catch (ackErr) {
        Log.error('ACK_FAILED after upload failure also failed — PROVIDER AMBIGUOUS', ackErr);
      }
    }
    return;
  }

  // ── Phase 5: ACK success ──
  if (uploadOk && successIds.length) {
    try {
      var ackRes = client.sendAck(cfg.SITE_ID, successIds, skippedIds, exportRunId);
      if (ackRes && ackRes.ok === false) {
        Log.error('ACK returned ok=false after successful upload — PROVIDER AMBIGUOUS', {
          affected: successIds.length });
        return;
      }
      Log.info('SYNC_GREEN', {
        uploaded: stats.uploaded,
        ack_updated: ackRes ? ackRes.updated : '?',
        pages: pageNo,
        export_run_id: exportRunId,
      });
    } catch (ackErr) {
      Log.error('ACK dispatch failed after upload.apply — DO NOT re-sync, use operator ACK', ackErr);
    }
  }
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

function main() {
  var cfg = loadConfig();

  if (!cfg.SITE_ID || !cfg.API_KEY) {
    Log.error('Missing config: set OPSMANTIK_SITE_ID and OPSMANTIK_API_KEY in Script Properties');
    return;
  }

  if (cfg.INCLUDE_HP && !cfg.HP_COLUMN) {
    Log.error('OPSMANTIK_INCLUDE_HASHED_PHONE=true but OPSMANTIK_HASHED_PHONE_COLUMN is empty');
    return;
  }

  Log.info('OpsMantik Universal OCI', {
    mode: cfg.RUN_MODE,
    site: cfg.SITE_ID.slice(0, 8) + '...',
    limit: cfg.LIMIT,
    max_pages: cfg.MAX_PAGES,
    include_hp: cfg.INCLUDE_HP,
  });

  var client = new OciClient(cfg.BASE_URL, cfg.API_KEY);
  client.handshake(cfg.SITE_ID);

  if (cfg.RUN_MODE === 'peek') {
    runPeek(cfg, client);
  } else {
    runSync(cfg, client);
  }
}
