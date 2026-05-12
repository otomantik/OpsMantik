import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const wrapperPath = join(process.cwd(), 'scripts', 'db', 'oci-canary-live-export.mjs');
const previewLibPath = join(process.cwd(), 'scripts', 'db', 'lib', 'oci-canary-preview-walk.mjs');
const dossierPath = join(process.cwd(), 'docs', 'OPS', 'PRODUCTION_CANARY_DOSSIER.md');

async function loadPreviewWalk() {
  return import(pathToFileURL(previewLibPath).href);
}

test('PR-9H.4A: live wrapper delegates cursor walk to shared preview lib', () => {
  const src = readFileSync(wrapperPath, 'utf8');
  assert.match(src, /runCanaryJournalPreviewWalk/);
  assert.match(src, /from '\.\/lib\/oci-canary-preview-walk\.mjs'/);
});

test('PR-9H.4A: live wrapper previews before mutating export URL', () => {
  const src = readFileSync(wrapperPath, 'utf8');
  const previewCall = src.indexOf('runCanaryJournalPreviewWalk(');
  const liveTrue = src.indexOf("markAsExported=true");
  assert.ok(previewCall >= 0 && liveTrue >= 0 && previewCall < liveTrue);
});

test('PR-9H.4A: dry-run exits before live URL construction', () => {
  const src = readFileSync(wrapperPath, 'utf8');
  const dryBranch = src.indexOf("mode: 'dry-run'");
  const liveUrlBase = src.indexOf('const liveUrlBase');
  assert.ok(dryBranch >= 0 && liveUrlBase >= 0 && dryBranch < liveUrlBase);
});

test('PR-9H.4A: live path uses incoming matched cursor not preview next_cursor for claim', () => {
  const src = readFileSync(wrapperPath, 'utf8');
  assert.match(src, /matchedIncomingCursor/);
  assert.doesNotMatch(src, /preview\?.next_cursor/);
});

test('PR-9H.4F.1: preview URL duplicates allowlist_ids query for hosted parity', () => {
  const src = readFileSync(previewLibPath, 'utf8');
  assert.match(src, /allowlist_ids=/);
});

test('PR-9H.4A: wrapper requires CLI mode (--dry-run or --live)', () => {
  const src = readFileSync(wrapperPath, 'utf8');
  assert.match(src, /--dry-run/);
  assert.match(src, /--live/);
  assert.match(src, /CLI_MODE_REQUIRED/);
});

test('PR-9H.4A: wrapper requires hardened metadata env vars', () => {
  const src = readFileSync(wrapperPath, 'utf8');
  assert.match(src, /readRequiredEnv\('CHANGE_TICKET'\)/);
  assert.match(src, /readRequiredEnv\('OPERATOR_ID'\)/);
  assert.match(src, /readRequiredEnv\('CANARY_APPROVAL'\)/);
  assert.match(src, /readRequiredEnv\('CANARY_EXPECTED_QUEUE_ID'\)/);
  assert.match(src, /function readCanaryApiKey/);
  assert.match(src, /CANARY_API_KEY/);
  assert.match(src, /CANARY_MAX_BATCH_SIZE_MUST_BE_1/);
});

test('PR-9H.4E: live path gates CANARY_UPLOAD_APPROVAL + OPSMANTIK_ALLOWLIST_IDS header', () => {
  const src = readFileSync(wrapperPath, 'utf8');
  assert.match(src, /REQUIRED_UPLOAD_APPROVAL/);
  assert.match(src, /CANARY_UPLOAD_APPROVAL_INVALID/);
  assert.match(src, /x-opsmantik-allowlist-ids/);
  assert.match(src, /OPSMANTIK_ALLOWLIST_IDS/);
});

test('PR-9H.4F: live path forbids localhost APP_BASE_URL', () => {
  const src = readFileSync(wrapperPath, 'utf8');
  assert.match(src, /LOCALHOST_LIVE_CANARY_FORBIDDEN/);
});

test('PR-9H.4B / PR-9H.4A: elevated stuck_processing requires exact CANARY_RISK_ACK token', () => {
  const src = readFileSync(wrapperPath, 'utf8');
  assert.match(src, /REQUIRED_CANARY_RISK_ACK = 'I_ACKNOWLEDGE_CANARY_SITE_RISK'/);
});

test('PR-9H.4A: wrapper blocks singleton rows that are not the expected queue id', () => {
  const src = readFileSync(wrapperPath, 'utf8');
  assert.match(src, /PREVIEW_UNEXPECTED_SINGLETON_ROW/);
});

test('PR-9H.4A: preview walk follows next_cursor until match or bound', async () => {
  const { runCanaryJournalPreviewWalk } = await loadPreviewWalk();
  /** @type {string[]} */
  const urls = [];
  const expectedQueueId = 'expected-q';

  /** @returns {unknown} */
  function bodyFor(idx) {
    if (idx < 4) {
      return { items: [], next_cursor: `c${idx + 1}` };
    }
    return {
      items: [{ id: expectedQueueId, conversionName: 'OpsMantik_Won' }],
      next_cursor: null,
    };
  }

  let requestIndex = -1;

  /** @type {typeof fetch} */
  const fetchFn = async (url /* , init */) => {
    urls.push(url.toString());
    requestIndex++;
    const u = url.toString();
    assert.ok(u.includes('markAsExported=false'), 'preview must stay read-only');
    assert.match(u, /[?&]canaryMode=true/);
    if (requestIndex > 0) assert.match(u, /[?&]cursor=/);
    const body = bodyFor(requestIndex);
    return new Response(JSON.stringify(body), { status: 200 });
  };

  const out = await runCanaryJournalPreviewWalk({
    baseUrl: 'https://ex.test',
    siteId: 'site-1',
    expectedQueueId,
    headers: { 'x-api-key': 'k' },
    fetchFn,
    maxPages: 50,
  });

  assert.ok(out.foundGood);
  assert.strictEqual(urls.length, 5);
  assert.strictEqual(out.matchedIncomingCursor, 'c4');
});

test('PR-9H.4A: preview walk respects maxPages when next_cursor never ends', async () => {
  const { runCanaryJournalPreviewWalk } = await loadPreviewWalk();
  /** @type {typeof fetch} */
  const fetchFn = async () =>
    new Response(JSON.stringify({ items: [], next_cursor: 'never-ends' }), { status: 200 });

  const out = await runCanaryJournalPreviewWalk({
    baseUrl: 'https://ex.test',
    siteId: 'site-1',
    expectedQueueId: 'ghost',
    headers: { 'x-api-key': 'k' },
    fetchFn,
    maxPages: 3,
  });

  assert.ok(!out.foundGood);
  assert.strictEqual(out.pagination.length, 3);
});

test('PR-9H.4A: itemConversionName supports conversionName camelCase', async () => {
  const { itemConversionName } = await loadPreviewWalk();
  assert.strictEqual(itemConversionName({ conversionName: 'OpsMantik_Won' }), 'OpsMantik_Won');
});

test('PR-9H.4A: itemConversionName supports conversion_name snake_case', async () => {
  const { itemConversionName } = await loadPreviewWalk();
  assert.strictEqual(itemConversionName({ conversion_name: 'OpsMantik_Won' }), 'OpsMantik_Won');
});

test('PR-9H.4A: scripts avoid queue deletion / manual COMPLETED / broad delete wording', () => {
  const w = readFileSync(wrapperPath, 'utf8');
  assert.doesNotMatch(w, /\.delete\(/);
  assert.doesNotMatch(w, /COMPLETED/);
});

test('PR-9H.4A: dossier records PR-9H.4A preview parity gate and separates PR-9H.4B', () => {
  const src = readFileSync(dossierPath, 'utf8');
  assert.match(src, /PR-9H\.4A/i);
  assert.match(src, /PR-9H\.4B/i);
});

test('PR-9H.4A: dossier retains PR-9C invalid stance', () => {
  const src = readFileSync(dossierPath, 'utf8');
  assert.match(src, /PR-9C/);
  assert.match(src, /CANARY_PROCESS_VIOLATION_REVIEW_REQUIRED/);
});

test('PR-9H.4A: shared preview lib is the single bounded cursor implementation', () => {
  const lib = readFileSync(previewLibPath, 'utf8');
  assert.match(lib, /runCanaryJournalPreviewWalk/);
  assert.match(lib, /matchedIncomingCursor/);
});
