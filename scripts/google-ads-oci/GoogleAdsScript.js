/**
 * OCI SYNC ENGINE v3.0 (Quantum Edition)
 * V8 Engine Native | Deterministic Sampling | Auto-Healing
 * Features: ES6 Classes, Exponential Backoff with Jitter, Script-owned Deterministic V1 Sampling,
 * Strict ANSI Time Validation, Memory-safe Batch Processing.
 */

'use strict';

// ========================================================================
// ENV CONFIGURATION (ScriptProperties or env fallback for local)
// ========================================================================
function getConfig() {
  let props = null;
  try {
    if (typeof PropertiesService !== 'undefined') {
      props = PropertiesService.getScriptProperties();
    }
  } catch (e) { /* ignore */ }
  const getFirst = function (keys, fallback) {
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (props) {
        const v = props.getProperty && props.getProperty(key);
        if (v) return v;
      }
      if (typeof process !== 'undefined' && process.env && process.env[key]) return process.env[key];
    }
    return fallback || '';
  };
  const isLocal = typeof require !== 'undefined' && require.main && require.main === module;
  return Object.freeze({
    SITE_ID: getFirst(['OPSMANTIK_SITE_ID', 'OCI_SITE_ID'], '') || (isLocal ? 'mock-site-id' : ''),
    API_KEY: getFirst(['OPSMANTIK_API_KEY', 'OCI_API_KEY'], '') || (isLocal ? 'mock-api-key' : ''),
    BASE_URL: getFirst(['OPSMANTIK_BASE_URL', 'OCI_BASE_URL'], '') || 'https://console.opsmantik.com',
    // Optional comma-separated queue-id allowlist for controlled one-shot exports.
    ALLOWLIST_IDS: getFirst(['OPSMANTIK_ALLOWLIST_IDS'], ''),
    HTTP: Object.freeze({
      MAX_RETRIES: 5,
      INITIAL_DELAY_MS: 1500,
      TIMEOUT_MS: 60000,
    }),
  });
}
const CONFIG = getConfig();

function parseAllowlistIds(raw) {
  const value = (raw || '').trim();
  if (!value) return null;
  const set = new Set(
    value
      .split(',')
      .map((x) => (x || '').trim())
      .filter((x) => x.length > 0)
  );
  return set.size > 0 ? set : null;
}

const CONVERSION_EVENTS = Object.freeze({
  CONTACTED: 'OpsMantik_Contacted',
  OFFERED: 'OpsMantik_Offered',
  WON: 'OpsMantik_Won',
  JUNK_EXCLUSION: 'OpsMantik_Junk_Exclusion',
});

// ========================================================================
// TELEMETRY SYSTEM
// ========================================================================
class Telemetry {
  static info(msg, meta = '') { Logger.log(`[INFO] ${msg} ${meta ? `| ${JSON.stringify(meta)}` : ''}`); }
  static warn(msg, meta = '') { Logger.log(`[WARN] ${msg} ${meta ? `| ${JSON.stringify(meta)}` : ''}`); }
  static error(msg, err = null) {
    Logger.log(`[ERROR] ${msg} | ${err ? (err.message || err) : ''}`);
    if (err && err.stack) Logger.log(`   Stack: ${err.stack}`);
  }
  static wtf(msg) { Logger.log(`[FATAL] ${msg}`); }
}

// ========================================================================
// DETERMINISTIC ENGINE & VALIDATORS
// ========================================================================
class Validator {
  /**
   * Google Ads: yyyyMMdd HHmmss (compact, no offset) or yyyy-mm-dd HH:mm:ss±HHmm.
   * Accept both ±HHmm and legacy ±HH:mm on input, then normalize to ±HHmm for CSV upload.
   */
  static isValidGoogleAdsTime(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return false;
    const s = timeStr.trim();
    if (/^\d{8} \d{6}$/.test(s)) return true;
    return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{2}:?\d{2}$/.test(s);
  }

  static normalizeGoogleAdsTime(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return '';
    const s = timeStr.trim();
    if (/^\d{8} \d{6}$/.test(s)) return s;
    return s.replace(/([+-]\d{2}):(\d{2})$/, '$1$2');
  }

  static analyze(row) {
    const clickId = row.gclid || row.wbraid || row.gbraid;
    if (!clickId) return { valid: false, reason: 'MISSING_CLICK_ID' };

    if (!row.conversionTime) return { valid: false, reason: 'MISSING_TIME' };
    if (!this.isValidGoogleAdsTime(row.conversionTime)) return { valid: false, reason: 'INVALID_TIME_FORMAT' };

    return { valid: true, clickId };
  }
}

// ========================================================================
// QUANTUM NETWORK LAYER (Auto-Healing HTTP)
// ========================================================================
class QuantumClient {
  constructor(baseUrl, apiKey) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.sessionToken = null;
    this.siteId = null;
  }

  /**
   * Akıllı Backoff (Jitter'lı Eksponansiyel Gecikme)
   */
  _fetchWithBackoff(url, options) {
    let attempt = 0;
    let delay = CONFIG.HTTP.INITIAL_DELAY_MS;

    while (attempt < CONFIG.HTTP.MAX_RETRIES) {
      try {
        const response = UrlFetchApp.fetch(url, { ...options, muteHttpExceptions: true });
        const code = response.getResponseCode();

        // Başarılı
        if (code >= 200 && code < 300) return response;

        // Rate Limit (429) veya Server Error (5xx) -> Backoff uygula
        if (code === 429 || code >= 500) {
          const body = response.getContentText();
          Telemetry.warn(`HTTP ${code} on attempt ${attempt + 1}. Retrying...`, { url, body: body.substring(0, 100) });
          // Fallthrough to sleep
        } else {
          // 400, 401, 403 vb. kritik hatalar. Retry yapma!
          throw new Error(`Kritik HTTP Hatası ${code}: ${response.getContentText()}`);
        }
      } catch (err) {
        if (attempt === CONFIG.HTTP.MAX_RETRIES - 1) throw err;
        Telemetry.warn(`Ağ Hatası (Deneme ${attempt + 1}): ${err.message}`);
      }

      attempt++;
      // Jitter ile çarpışmaları önle (Thundering Herd engelleme)
      const jitter = Math.random() * 500;
      Utilities.sleep(delay + jitter);
      delay *= 2; // Eksponansiyel Artış
    }
    throw new Error(`Bütün ${CONFIG.HTTP.MAX_RETRIES} ağ denemesi başarısız oldu: ${url}`);
  }

  verifyHandshake(siteId) {
    this.siteId = siteId;
    const url = `${this.baseUrl}/api/oci/v2/verify`;
    const response = this._fetchWithBackoff(url, {
      method: 'post',
      headers: { 'x-api-key': this.apiKey, 'Content-Type': 'application/json' },
      payload: JSON.stringify({ siteId })
    });

    const data = JSON.parse(response.getContentText());
    if (!data.session_token) throw new Error("Beklenmeyen Yanıt: session_token eksik.");
    this.sessionToken = data.session_token;
  }

  _isUnauthorized(err) {
    const msg = err && err.message ? String(err.message) : String(err || '');
    return msg.indexOf('Kritik HTTP Hatası 401') >= 0 || msg.indexOf('Kritik HTTP Hatasi 401') >= 0;
  }

  _fetchWithSessionRetry(url, options) {
    try {
      return this._fetchWithBackoff(url, options);
    } catch (err) {
      if (!this.sessionToken || !this.siteId || !this._isUnauthorized(err)) throw err;
      Telemetry.warn('Session token expired, renewing handshake and retrying once...', { url });
      this.verifyHandshake(this.siteId);
      const nextHeaders = Object.assign({}, options && options.headers ? options.headers : {});
      if (nextHeaders.Authorization) {
        nextHeaders.Authorization = `Bearer ${this.sessionToken}`;
      }
      return this._fetchWithBackoff(url, Object.assign({}, options, { headers: nextHeaders }));
    }
  }

  fetchConversionsPage(siteId, cursor) {
    let url = `${this.baseUrl}/api/oci/google-ads-export?siteId=${encodeURIComponent(siteId)}&markAsExported=true&limit=200`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
    const response = this._fetchWithSessionRetry(url, {
      method: 'get',
      headers: {
        'Authorization': `Bearer ${this.sessionToken}`,
        'Accept': 'application/json'
      }
    });
    const payload = JSON.parse(response.getContentText() || '{}');
    if (Array.isArray(payload)) {
      return { items: payload, nextCursor: null };
    }
    const data = Array.isArray(payload.data) ? payload.data : (Array.isArray(payload.items) ? payload.items : []);
    const nextCursor = payload.meta && typeof payload.meta === 'object'
      ? payload.meta.nextCursor || null
      : (payload.next_cursor || null);
    const hasNextPage = payload.meta && typeof payload.meta === 'object'
      ? payload.meta.hasNextPage === true
      : Boolean(nextCursor);
    return { items: data, nextCursor, hasNextPage };
  }

  processConversionPages(siteId, onPage, onPageError) {
    let cursor = null;
    let hasNextPage = true;
    let pageCount = 0;
    do {
      const page = this.fetchConversionsPage(siteId, cursor);
      pageCount++;
      if (page.items && page.items.length > 0) {
        try {
          onPage(page.items, pageCount);
        } catch (err) {
          Telemetry.error(`Sayfa ${pageCount} isleme hatasi`, err);
          if (typeof onPageError === 'function') {
            try {
              onPageError(page.items, pageCount, err);
            } catch (handlerErr) {
              Telemetry.error(`Sayfa ${pageCount} hata-isleyici arizasi`, handlerErr);
            }
          }
          // Fail-closed: do not continue silently with partially processed pages.
          throw err;
        }
      }
      cursor = page.nextCursor;
      hasNextPage = Boolean(page.hasNextPage && cursor);
    } while (hasNextPage);
    return pageCount;
  }

  sendAck(siteId, queueIds, skippedIds, failedRows) {
    if (!queueIds.length && (!skippedIds || !skippedIds.length) && (!failedRows || !failedRows.length)) return null;
    const url = `${this.baseUrl}/api/oci/ack`;
    const payload = { siteId, queueIds: queueIds || [] };
    if (skippedIds && skippedIds.length > 0) payload.skippedIds = skippedIds;
    if (failedRows && failedRows.length > 0) {
      payload.results = []
        .concat((queueIds || []).map(function (id) { return { id: id, status: 'SUCCESS' }; }))
        .concat((failedRows || []).map(function (f) {
          return { id: f.queueId, status: 'FAILED', reason: f.errorCode || 'SCRIPT_ROW_FAILED' };
        }));
    }
    const response = this._fetchWithSessionRetry(url, {
      method: 'post',
      headers: {
        'Authorization': `Bearer ${this.sessionToken}`,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(payload)
    });
    try {
      return JSON.parse(response.getContentText() || '{}');
    } catch {
      return { ok: false, raw: response.getContentText?.() ?? '' };
    }
  }

  sendAckFailed(siteId, queueIds, errorCode, errorMessage, errorCategory) {
    if (!queueIds.length) return;
    const url = `${this.baseUrl}/api/oci/ack-failed`;
    this._fetchWithSessionRetry(url, {
      method: 'post',
      headers: {
        'Authorization': `Bearer ${this.sessionToken}`,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify({
        siteId,
        queueIds,
        errorCode: errorCode || 'VALIDATION_FAILED',
        errorMessage: errorMessage || errorCode,
        errorCategory: errorCategory || 'VALIDATION'
      })
    });
  }
}

// ========================================================================
// GOOGLE ADS UPLOAD ENGINE
// ========================================================================
class UploadEngine {
  constructor() {
    this.columns = [
      'Order ID',
      'Google Click ID',
      'Conversion name',
      'Conversion time',
      'Conversion value',
      'Conversion currency'
    ];
  }

  process(conversions, opts) {
    const timezone = AdsApp.currentAccount().getTimeZone() || 'Europe/Istanbul';
    const upload = AdsApp.bulkUploads().newCsvUpload(this.columns, {
      moneyInMicros: false,
      timeZone: timezone
    });
    upload.forOfflineConversions();
    upload.setFileName(`Eslamed_OCI_Quantum_${new Date().toISOString()}.csv`);

    const stats = {
      uploaded: 0,
      skippedDeterministic: 0,
      skippedValidation: 0,
      successIds: [],
      skippedIds: [],
      failedRows: [],
      uploadFailed: false,
    };

    for (const row of conversions) {
      const validation = Validator.analyze(row);

      if (!validation.valid) {
        if (validation.reason === 'DETERMINISTIC_SKIP') {
          stats.skippedDeterministic++;
          if (row.id) stats.skippedIds.push(row.id);
          continue;
        }
        Telemetry.warn(`Hatali Satir Atlandi: ${validation.reason}`, { id: row.id || 'N/A' });
        stats.skippedValidation++;
        if (row.id) {
          stats.failedRows.push({
            queueId: row.id,
            errorCode: validation.reason,
            errorMessage: validation.reason,
            errorCategory: 'VALIDATION'
          });
        }
        continue;
      }

      const conversionValue = parseFloat(String(row.conversionValue || 0).replace(/[^\d.-]/g, '')) || 0;

      const orderIdRaw = row.orderId || row.id || '';
      const orderId = String(orderIdRaw).substring(0, 64);  // Google Ads Order ID max 64 karakter
      upload.append({
        'Order ID': orderId,
        'Google Click ID': validation.clickId,
        'Conversion name': (row.conversionName || '').trim() || CONVERSION_EVENTS.WON,
        'Conversion time': Validator.normalizeGoogleAdsTime(row.conversionTime),
        'Conversion value': Math.max(0, conversionValue),
        'Conversion currency': (row.conversionCurrency || 'TRY').toUpperCase()
      });

      stats.uploaded++;
      if (row.id) stats.successIds.push(row.id);
    }

    if (stats.uploaded > 0) {
      try {
        upload.apply();
      } catch (err) {
        if (typeof opts?.onUploadFailure === 'function' && stats.successIds.length > 0) {
          const msg = (err && err.message) ? String(err.message).slice(0, 500) : 'UPLOAD_EXCEPTION';
          opts.onUploadFailure(stats.successIds, 'UPLOAD_EXCEPTION', msg, 'TRANSIENT');
        }
        return Object.assign({}, stats, { uploadFailed: true });
      }
    }

    return stats;
  }
}

// ========================================================================
// MAIN EXECUTION (ENTRY POINT)
// ========================================================================
function main() {
  Telemetry.info('Eslamed Quantum OCI Engine Baslatiliyor...');

  try {
    const client = new QuantumClient(CONFIG.BASE_URL, CONFIG.API_KEY);

    // 1. Quantum Handshake
    Telemetry.info('Ag protokolu dogrulaniyor...');
    client.verifyHandshake(CONFIG.SITE_ID);

    // 2. Fetch and process pages (memory-safe)
    Telemetry.info('Kuyruk dinleniyor...');
    let hasAnyWork = false;
    let totalUploaded = 0;
    let totalSkippedDeterministic = 0;
    let totalSkippedValidation = 0;
    let totalAckUpdated = 0;
    let totalAutoFailedUploadApply = 0;
    let totalAutoFailedPageProcessing = 0;
    let totalPages = 0;

    // Optional one-shot controlled export: only process IDs from allowlist.
    const allowlistIds = parseAllowlistIds(CONFIG.ALLOWLIST_IDS);
    if (allowlistIds) {
      Telemetry.warn('ALLOWLIST MODE ACTIVE', { allowlist_count: allowlistIds.size });
    }

    // 3. Upload & Validate per page
    const engine = new UploadEngine();
    totalPages = client.processConversionPages(CONFIG.SITE_ID, function (conversions, pageNo) {
      if (!Array.isArray(conversions) || conversions.length === 0) return;
      const filtered = allowlistIds
        ? conversions.filter((row) => row && row.id && allowlistIds.has(String(row.id)))
        : conversions;
      if (!filtered.length) return;
      hasAnyWork = true;
      Telemetry.info(`Sayfa ${pageNo}: ${filtered.length}/${conversions.length} satir secildi. Validasyon basliyor...`);
      const stats = engine.process(filtered, {
        onUploadFailure: function (ids, errorCode, errorMessage, errorCategory) {
          if (ids && ids.length > 0) {
            Telemetry.warn('Upload apply failed; marking appended rows FAILED (TRANSIENT)', { count: ids.length, page: pageNo });
            client.sendAckFailed(CONFIG.SITE_ID, ids, errorCode, errorMessage, errorCategory);
            totalAutoFailedUploadApply += ids.length;
          }
        }
      });

      totalUploaded += stats.uploaded || 0;
      totalSkippedDeterministic += stats.skippedDeterministic || 0;
      totalSkippedValidation += stats.skippedValidation || 0;

      Telemetry.info(
        `Sayfa ${pageNo} bilanco: Yuklendi=${stats.uploaded}, Deterministic Skip=${stats.skippedDeterministic || 0}, Validation Fail=${stats.skippedValidation || 0}`
      );

      // 4. Muhurleme (ACK) - uploadFailed invariant: ACK blokla
      if (stats.uploadFailed) return;

      if (
        stats.successIds.length > 0 ||
        (stats.skippedIds && stats.skippedIds.length > 0) ||
        (stats.failedRows && stats.failedRows.length > 0)
      ) {
        const total =
          (stats.successIds.length || 0) +
          ((stats.skippedIds && stats.skippedIds.length) || 0) +
          ((stats.failedRows && stats.failedRows.length) || 0);
        Telemetry.info(`Sayfa ${pageNo}: ${total} kayit icin API\'ye Muhur (ACK) gonderiliyor...`);
        const ackRes = client.sendAck(CONFIG.SITE_ID, stats.successIds, stats.skippedIds, stats.failedRows || []);
        if (ackRes) {
          totalAckUpdated += Number(ackRes.updated || 0);
          Telemetry.info(
            `Sayfa ${pageNo} ACK: ok=${!!ackRes.ok}, updated=${ackRes.updated != null ? ackRes.updated : 0}${
              ackRes.warnings ? ` | uyari=${JSON.stringify(ackRes.warnings)}` : ''
            }`
          );
        }
      }
    }, function (conversions, pageNo, err) {
      const ids = (Array.isArray(conversions) ? conversions : [])
        .map(function (row) { return row && row.id ? String(row.id) : ''; })
        .filter(function (id) { return id.length > 0; });
      if (ids.length > 0) {
        const msg = (err && err.message) ? String(err.message).slice(0, 500) : 'PAGE_PROCESSING_FAILURE';
        Telemetry.warn(`Sayfa ${pageNo}: ${ids.length} kayit TRANSIENT fail olarak isaretleniyor`, { reason: msg });
        client.sendAckFailed(CONFIG.SITE_ID, ids, 'PAGE_PROCESSING_FAILURE', msg, 'TRANSIENT');
        totalAutoFailedPageProcessing += ids.length;
      }
    });

    if (!hasAnyWork) {
      Telemetry.info('Islenecek yeni donusum bulunamadi. Uyku moduna geciliyor.');
      return;
    }

    Telemetry.info(
      `Toplam bilanco: sayfa=${totalPages}, yuklendi=${totalUploaded}, deterministicSkip=${totalSkippedDeterministic}, validationFail=${totalSkippedValidation}, ackUpdated=${totalAckUpdated}, autoFailedUploadApply=${totalAutoFailedUploadApply}, autoFailedPageProcessing=${totalAutoFailedPageProcessing}, autoFailedTotal=${totalAutoFailedUploadApply + totalAutoFailedPageProcessing}`
    );
    Telemetry.info('Senkronizasyon tamamlandi.');

  } catch (error) {
    Telemetry.wtf('Script kritik bir cekirdek hatasiyla durduruldu.');
    Telemetry.error('İz Dökümü', error);
  }
}

// ========================================================================
// LOCAL TESTING ENVIRONMENT (Mock Google Ads API)
// ========================================================================
if (typeof module !== 'undefined' && require !== 'undefined' && require.main === module) {
  console.log('[LOCAL] OCI Quantum Script - Local Execution Mode Started...');

  // Mock Logger
  global.Logger = {
    log: function (msg) { console.log(msg); }
  };

  // Mock Utilities
  global.Utilities = {
    sleep: function (ms) {
      const waitTill = new Date(new Date().getTime() + ms);
      while (waitTill > new Date()) { }
    }
  };

  // Mock UrlFetchApp
  global.UrlFetchApp = {
    fetch: function (url, options) {
      console.log(`\n[Mock UrlFetchApp] -> ${options.method.toUpperCase()} ${url}`);
      return {
        getResponseCode: () => 200,
        getContentText: () => {
          if (url.includes('/api/oci/v2/verify')) {
            return JSON.stringify({ session_token: 'mock_quantum_token_12345' });
          }
          if (url.includes('/api/oci/google-ads-export')) {
            return JSON.stringify({
              items: [
                {
                  id: 'mock-conv-1',
                  gclid: 'TEST_GCLID_QWERT123',
                  conversionName: 'OpsMantik_Won',
                  conversionTime: '2026-03-01 15:30:00+0300',
                  conversionValue: 5000,
                  conversionCurrency: 'TRY'
                },
                {
                  id: 'mock-conv-2',
                  wbraid: 'TEST_WBRAID_XYZ890',
                  conversionName: 'OpsMantik_Contacted',
                  conversionTime: '2026-03-01 16:45:00+0300',
                  conversionValue: 0,
                  conversionCurrency: 'TRY'
                },
                {
                  id: 'mock-conv-3',
                  gclid: 'TEST_GCLID_INVALID_TIME',
                  conversionName: 'OpsMantik_Won',
                  conversionTime: '2026-03-01',
                  conversionValue: 1000,
                  conversionCurrency: 'TRY'
                }
              ],
              next_cursor: null
            });
          }
          if (url.includes('/api/oci/ack')) {
            return JSON.stringify({ updated: 2 });
          }
          if (url.includes('/api/oci/ack-failed')) {
            return JSON.stringify({ ok: true, updated: 1 });
          }
          return '{}';
        }
      };
    }
  };

  // Mock AdsApp
  global.AdsApp = {
    currentAccount: () => ({
      getTimeZone: () => 'Europe/Istanbul'
    }),
    bulkUploads: () => ({
      newCsvUpload: (columns, config) => ({
        forOfflineConversions: () => { },
        setFileName: (name) => { console.log(`[Mock AdsApp] Upload file created: ${name}`); },
        append: (row) => { console.log(`[Mock AdsApp] Row Appended:`, row); },
        apply: () => { console.log('[Mock AdsApp] Upload Applied to Google Ads Successfully!'); }
      })
    })
  };

  // Execute
  console.log('--------------------------------------------------');
  main();
  console.log('--------------------------------------------------');
  console.log('[LOCAL] Execution finished.');
}
