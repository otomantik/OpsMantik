/**
 * OCI Truth — Google Ads Script fleet: dispatch-pending ACK + click-id hygiene, with explicit quarantine for legacy files.
 * @see scripts/google-ads-oci/fleet-quarantine.json
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, normalize } from 'node:path';
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
  replacementCanonical?: string;
  lastKnownUse?: string;
};

type QuarantineFile = {
  version: number;
  entries: QuarantineEntry[];
};

/** Paths relative to `scripts/google-ads-oci/` (forward slashes). */
function listFleetScriptRels(): string[] {
  const out: string[] = [];
  for (const n of readdirSync(SCRIPT_DIR)) {
    if (/^GoogleAdsScript.*\.js$/.test(n)) out.push(n.replace(/\\/g, '/'));
  }
  const arch = join(SCRIPT_DIR, '_archive', 'quarantine-forks');
  if (existsSync(arch)) {
    for (const n of readdirSync(arch)) {
      if (/^GoogleAdsScript.*\.js$/.test(n)) {
        out.push(`_archive/quarantine-forks/${n}`.replace(/\\/g, '/'));
      }
    }
  }
  return [...new Set(out)].sort();
}

function artifactAbs(entryFile: string): string {
  const norm = entryFile.replace(/\\/g, '/');
  if (norm.startsWith('tests/')) {
    return normalize(join(process.cwd(), ...norm.split('/')));
  }
  return normalize(join(SCRIPT_DIR, ...norm.split('/')));
}

function loadQuarantine(): QuarantineFile {
  const raw = readFileSync(QUARANTINE_PATH, 'utf8');
  return JSON.parse(raw) as QuarantineFile;
}

const BANNED_COMBINED_CLICK_ID = /\b(?:var|const)\s+clickId\s*=\s*row\.gclid\s*\|\|\s*row\.wbraid\s*\|\|\s*row\.gbraid\b/;
const ACK_RESULTS_IN_PAYLOAD = /sendAck\s*=\s*function[\s\S]{0,2500}payload\.results\b/;

test('fleet-quarantine.json schema and sunset discipline', () => {
  const q = loadQuarantine();
  assert.equal(q.version, 2);
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
    if (e.productionSafe === false) {
      assert.ok(
        e.replacementCanonical && e.replacementCanonical.length > 0,
        `${e.file}: quarantined entry must set replacementCanonical`
      );
      const abs = artifactAbs(e.file);
      assert.ok(existsSync(abs), `quarantine entry must exist on disk: ${e.file}`);
    }
  }
});

test('every GoogleAdsScript*.js is either quarantined (legacy) or passes truth contract', () => {
  const q = loadQuarantine();
  const quarantined = new Set(
    q.entries.filter((e) => e.productionSafe === false).map((e) => e.file.replace(/\\/g, '/'))
  );
  const files = listFleetScriptRels();
  assert.ok(files.length >= 1, 'expected at least one GoogleAdsScript*.js');
  const nonQuarantined = files.filter((rel) => !quarantined.has(rel)).sort();
  assert.deepEqual(
    nonQuarantined,
    ['GoogleAdsScriptUniversal.js'],
    'only GoogleAdsScriptUniversal.js may be non-quarantined; new forks need fleet-quarantine.json + exception approval'
  );
  for (const rel of files) {
    const abs = normalize(join(SCRIPT_DIR, ...rel.split('/')));
    const src = readFileSync(abs, 'utf8');
    if (quarantined.has(rel)) {
      assert.ok(
        src.includes('fleet-quarantine.json') || src.includes('OCI_FLEET_QUARANTINE'),
        `${rel}: quarantined scripts should reference fleet quarantine in a header comment`
      );
      continue;
    }
    assert.ok(
      src.includes('pendingConfirmation') &&
        src.includes('providerConfirmationMode') &&
        src.includes('bulk_upload_async_unconfirmed'),
      `${rel}: non-quarantined fleet script must send dispatch-pending ACK flags on script success path`
    );
    assert.ok(
      !ACK_RESULTS_IN_PAYLOAD.test(src),
      `${rel}: ACK success path must not embed payload.results (use sendAckFailed for failures)`
    );
    assert.ok(!BANNED_COMBINED_CLICK_ID.test(src), `${rel}: must not use combined clickId = gclid||wbraid||gbraid (use PR-9I selection)`);
    assert.ok(
      !/Utilities\.computeDigest|DigestAlgorithm/i.test(src),
      `${rel}: must not use Utilities.computeDigest / DigestAlgorithm (raw hashing); courier hash only from server JSON`
    );
  }
  for (const e of q.entries.filter((x) => x.productionSafe === false)) {
    const norm = e.file.replace(/\\/g, '/');
    if (!norm.startsWith('tests/')) continue;
    const abs = artifactAbs(e.file);
    const src = readFileSync(abs, 'utf8');
    assert.ok(
      src.includes('fleet-quarantine.json') || src.includes('OCI_FLEET_QUARANTINE'),
      `${e.file}: quarantined fixture must document fleet quarantine provenance`
    );
  }
});
