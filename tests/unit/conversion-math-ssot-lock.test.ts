import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildOptimizationSnapshot } from '@/lib/oci/optimization-contract';
import {
  CONVERSION_VALUE_POLICY_VERSION,
  resolveMarketingSignalEconomics,
  resolveWonConversionEconomics,
} from '@/lib/oci/marketing-signal-value-ssot';

const ROOT = process.cwd();

test('PR-D: contacted/offered/junk are resolved by SSOT policy surface', () => {
  const contacted = resolveMarketingSignalEconomics({
    stage: 'contacted',
    snapshot: buildOptimizationSnapshot({ stage: 'contacted', systemScore: 60 }),
    siteCurrency: 'TRY',
  });
  const offered = resolveMarketingSignalEconomics({
    stage: 'offered',
    snapshot: buildOptimizationSnapshot({ stage: 'offered', systemScore: 60 }),
    siteCurrency: 'TRY',
  });
  const junk = resolveMarketingSignalEconomics({
    stage: 'junk',
    snapshot: buildOptimizationSnapshot({ stage: 'junk', systemScore: 60 }),
    siteCurrency: 'TRY',
  });

  assert.equal(contacted.policyVersion, CONVERSION_VALUE_POLICY_VERSION);
  assert.equal(contacted.conversionName, 'OpsMantik_Contacted');
  assert.equal(offered.conversionName, 'OpsMantik_Offered');
  assert.equal(junk.conversionName, 'OpsMantik_Junk_Exclusion');
  assert.equal(junk.expectedValueCents, 10);
});

test('PR-D: won policy uses SSOT and preserves fallback provenance', () => {
  const withRevenue = resolveWonConversionEconomics({
    snapshot: buildOptimizationSnapshot({ stage: 'won', systemScore: 80, actualRevenue: 1000 }),
    siteCurrency: 'TRY',
  });
  const withoutRevenue = resolveWonConversionEconomics({
    snapshot: buildOptimizationSnapshot({ stage: 'won', systemScore: 80, actualRevenue: null }),
    siteCurrency: 'TRY',
  });

  assert.equal(withRevenue.conversionName, 'OpsMantik_Won');
  assert.equal(withRevenue.fallbackUsed, false);
  assert.equal(withRevenue.valueSource, 'won_stage_model_with_actual_revenue');
  assert.equal(withoutRevenue.fallbackUsed, true);
  assert.equal(withoutRevenue.valueSource, 'won_stage_model_fallback');
  assert.ok(withRevenue.expectedValueCents >= 6000 && withRevenue.expectedValueCents <= 12000);
  assert.ok(withoutRevenue.expectedValueCents >= 6000 && withoutRevenue.expectedValueCents <= 12000);
});

test('PR-D: enqueue/upsert paths do not keep local ad-hoc value math', () => {
  const enqueueSrc = readFileSync(join(ROOT, 'lib', 'oci', 'enqueue-seal-conversion.ts'), 'utf8');
  const upsertSrc = readFileSync(join(ROOT, 'lib', 'domain', 'mizan-mantik', 'upsert-marketing-signal.ts'), 'utf8');
  assert.ok(enqueueSrc.includes('resolveWonConversionEconomics'));
  assert.ok(enqueueSrc.includes('value_policy_version'));
  assert.ok(!enqueueSrc.includes('Math.round(valueUnits * 100)'));
  assert.ok(upsertSrc.includes('value_policy_version'));
  assert.ok(upsertSrc.includes('value_policy_reason'));
  assert.ok(upsertSrc.includes('value_fallback_used'));
});

test('PR-D: DB guardrail migration exists and is ordered after OCI P0 migrations', () => {
  const migrationsDir = join(ROOT, 'supabase', 'migrations');
  const files = readdirSync(migrationsDir).sort();
  const idxP0 = files.findIndex((f) => f === '20260506125500_create_call_funnel_projection_table.sql');
  const idxGuard = files.findIndex((f) => f === '20260506133000_conversion_value_policy_guardrails_v1.sql');
  assert.ok(idxP0 >= 0, 'P0 projection migration must exist');
  assert.ok(idxGuard > idxP0, 'PR-D guardrail migration must be ordered after P0 migrations');

  const src = readFileSync(join(migrationsDir, '20260506133000_conversion_value_policy_guardrails_v1.sql'), 'utf8');
  assert.ok(src.includes('validate_conversion_value_policy_v1'));
  assert.ok(src.includes('OCI_VALUE_POLICY_V1_VIOLATION:'));
});

test('PR-D: health SQL includes per-signal drift and GREEN/RED semantics', () => {
  const path = join(ROOT, 'scripts', 'sql', 'value_integrity_health.sql');
  assert.ok(existsSync(path));
  const src = readFileSync(path, 'utf8');
  for (const name of ['OpsMantik_Contacted', 'OpsMantik_Offered', 'OpsMantik_Won', 'OpsMantik_Junk_Exclusion']) {
    assert.ok(src.includes(name), `health SQL must include ${name}`);
  }
  assert.ok(src.includes('policy_version'));
  assert.ok(src.includes('contract_status'));
  assert.ok(src.includes('GREEN'));
  assert.ok(src.includes('RED'));
});

test('PR-D: repair playbook is dry-run-first and non-destructive', () => {
  const path = join(ROOT, 'scripts', 'sql', 'conversion_value_policy_repair_playbook.sql');
  assert.ok(existsSync(path), 'repair playbook must exist');
  const src = readFileSync(path, 'utf8');
  assert.ok(src.includes('dry-run'));
  assert.ok(src.includes('Never delete rows from offline_conversion_queue'));
  assert.ok(!/DELETE\s+FROM\s+public\.offline_conversion_queue/i.test(src));
});

test('PR-D: unsafe db scripts require explicit override for value writes', () => {
  const scripts = [
    'scripts/db/oci-enqueue.mjs',
    'scripts/db/oci-eslamed-fix-values-and-enqueue.mjs',
    'scripts/db/oci-muratcan-v3-value-fix.mjs',
    'scripts/db/oci-fix-zero-value-queue.mjs',
  ];
  for (const rel of scripts) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    assert.ok(
      src.includes('ALLOW_UNSAFE_OCI_VALUE_WRITE'),
      `${rel} must require explicit unsafe write override`
    );
  }
});
