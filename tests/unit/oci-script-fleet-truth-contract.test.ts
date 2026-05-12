/**
 * OCI Truth — Google Ads Script fleet: dispatch-pending ACK + click-id hygiene, with explicit quarantine for legacy files.
 * @see scripts/google-ads-oci/fleet-quarantine.json
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const SCRIPT_DIR = join(process.cwd(), 'scripts', 'google-ads-oci');
const QUARANTINE_PATH = join(SCRIPT_DIR, 'fleet-quarantine.json');

type QuarantineEntry = {
  file: string;
  owner: string;
  reason: string;
  productionSafe: boolean;
  sunsetDate: string;
  replacementPlan: string;
};

type QuarantineFile = {
  version: number;
  entries: QuarantineEntry[];
};

function listFleetScripts(): string[] {
  return readdirSync(SCRIPT_DIR).filter((n) => /^GoogleAdsScript.*\.js$/.test(n)).sort();
}

function loadQuarantine(): QuarantineFile {
  const raw = readFileSync(QUARANTINE_PATH, 'utf8');
  return JSON.parse(raw) as QuarantineFile;
}

const BANNED_COMBINED_CLICK_ID = /\b(?:var|const)\s+clickId\s*=\s*row\.gclid\s*\|\|\s*row\.wbraid\s*\|\|\s*row\.gbraid\b/;
const ACK_RESULTS_IN_PAYLOAD = /sendAck\s*=\s*function[\s\S]{0,2500}payload\.results\b/;

test('fleet-quarantine.json schema and sunset discipline', () => {
  const q = loadQuarantine();
  assert.equal(q.version, 1);
  assert.ok(Array.isArray(q.entries));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const e of q.entries) {
    assert.ok(e.file && e.owner && e.reason && e.replacementPlan, `entry missing required field: ${JSON.stringify(e)}`);
    assert.equal(typeof e.productionSafe, 'boolean');
    assert.match(e.sunsetDate, /^\d{4}-\d{2}-\d{2}$/, `sunsetDate must be YYYY-MM-DD: ${e.file}`);
    const sd = new Date(`${e.sunsetDate}T00:00:00Z`);
    assert.ok(!Number.isNaN(sd.getTime()), `invalid sunset: ${e.file}`);
    if (e.productionSafe === false && sd < today) {
      assert.fail(
        `Quarantine sunset passed for ${e.file} — triage or update replacementPlan / remove file from production (sunset=${e.sunsetDate})`
      );
    }
  }
});

test('every GoogleAdsScript*.js is either quarantined (legacy) or passes truth contract', () => {
  const q = loadQuarantine();
  const quarantined = new Set(q.entries.filter((e) => e.productionSafe === false).map((e) => e.file));
  const files = listFleetScripts();
  assert.ok(files.length >= 1, 'expected at least one GoogleAdsScript*.js');
  for (const name of files) {
    const src = readFileSync(join(SCRIPT_DIR, name), 'utf8');
    if (quarantined.has(name)) {
      assert.ok(
        src.includes('fleet-quarantine.json') || src.includes('OCI_FLEET_QUARANTINE'),
        `${name}: quarantined scripts should reference fleet quarantine in a header comment`
      );
      continue;
    }
    assert.ok(
      src.includes('pendingConfirmation') && src.includes('bulk_upload_async_unconfirmed'),
      `${name}: non-quarantined fleet script must send dispatch-pending ACK flags on script success path`
    );
    assert.ok(
      !ACK_RESULTS_IN_PAYLOAD.test(src),
      `${name}: ACK success path must not embed payload.results (use sendAckFailed for failures)`
    );
    assert.ok(!BANNED_COMBINED_CLICK_ID.test(src), `${name}: must not use combined clickId = gclid||wbraid||gbraid (use PR-9I selection)`);
    assert.ok(
      !/Utilities\.computeDigest|DigestAlgorithm/i.test(src),
      `${name}: must not use Utilities.computeDigest / DigestAlgorithm (raw hashing); courier hash only from server JSON`
    );
  }
});
