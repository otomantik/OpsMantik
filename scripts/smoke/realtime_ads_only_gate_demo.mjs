/**
 * Demo harness: Ads-only realtime gate behavior.
 *
 * Goal:
 * - non-ads payloads are NOT injected
 * - unknown payloads are NOT injected; refetch-only is triggered
 *
 * This is a lightweight simulation of the rules implemented in useRealtimeDashboard.
 */

function decideAdsFromPayload(payload) {
  const meta = payload?.metadata || payload?.meta || {};
  const get = (obj, k) => (typeof obj?.[k] === 'string' && obj[k].trim() ? obj[k].trim() : null);

  const gclid = get(meta, 'gclid') || get(payload, 'gclid');
  const wbraid = get(meta, 'wbraid') || get(payload, 'wbraid');
  const gbraid = get(meta, 'gbraid') || get(payload, 'gbraid');
  const attributionSource = get(meta, 'attribution_source') || get(payload, 'attribution_source');
  const utmSource = get(meta, 'utm_source') || get(payload, 'utm_source');
  const utmMedium = get(meta, 'utm_medium') || get(payload, 'utm_medium');

  if (gclid || wbraid || gbraid) return { kind: 'ads', reason: 'click_id_present' };
  if (utmMedium) {
    const m = utmMedium.toLowerCase();
    if (['cpc', 'ppc', 'paid', 'paidsearch', 'paid_search', 'ads'].includes(m)) return { kind: 'ads', reason: `utm_medium=${m}` };
  }
  if (attributionSource) {
    const s = attributionSource.toLowerCase();
    if (s.includes('ads') || s.includes('google') || s.includes('gads') || s.includes('adwords')) return { kind: 'ads', reason: `attribution_source=${s}` };
    return { kind: 'non_ads', reason: `attribution_source=${s}` };
  }
  if (utmSource || utmMedium) return { kind: 'non_ads', reason: 'utm_present_no_paid_signal' };
  return { kind: 'unknown', reason: 'insufficient_payload_fields' };
}

function gate({ adsOnly, payload, lookupResult }) {
  if (!adsOnly) return { inject: true, refetchOnly: false, reason: 'adsOnly=false' };
  const signal = decideAdsFromPayload(payload);
  if (signal.kind === 'non_ads') return { inject: false, refetchOnly: false, reason: `drop_non_ads(${signal.reason})` };
  if (lookupResult === 'ads') return { inject: true, refetchOnly: false, reason: 'inject_lookup_ads' };
  if (lookupResult === 'non_ads') return { inject: false, refetchOnly: false, reason: 'drop_lookup_non_ads' };
  return { inject: false, refetchOnly: true, reason: `refetch_only(${signal.reason})` };
}

const cases = [
  {
    name: 'Non-ads event (explicit attribution_source=organic) => IGNORE',
    payload: { id: 'evt1', session_id: 's1', metadata: { attribution_source: 'organic' } },
    lookupResult: 'skipped',
    expect: { inject: false, refetchOnly: false },
  },
  {
    name: 'Unknown event payload + lookup error => REFETCH ONLY',
    payload: { id: 'evt2', session_id: 's2', metadata: {} },
    lookupResult: 'error',
    expect: { inject: false, refetchOnly: true },
  },
  {
    name: 'Ads event (gclid present) => INJECT',
    payload: { id: 'evt3', session_id: 's3', metadata: { gclid: 'test' } },
    lookupResult: 'ads',
    expect: { inject: true, refetchOnly: false },
  },
  {
    name: 'Non-ads call (no matched_session_id) => REFETCH ONLY',
    payload: { id: 'call1', matched_session_id: null },
    lookupResult: 'error',
    expect: { inject: false, refetchOnly: true },
  },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const out = gate({ adsOnly: true, payload: c.payload, lookupResult: c.lookupResult });
  const ok = out.inject === c.expect.inject && out.refetchOnly === c.expect.refetchOnly;
  if (ok) {
    pass += 1;
    console.log('PASS', c.name, '->', out);
  } else {
    fail += 1;
    console.log('FAIL', c.name, '->', out, 'expected', c.expect);
  }
}

if (fail > 0) process.exit(1);
console.log(`\n✅ ALL PASS (${pass} cases)`);

