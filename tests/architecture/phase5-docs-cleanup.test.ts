/**
 * Phase 5 docs cleanup pins.
 *
 * We pruned historical per-site forensic notes, cosmic-naming-scheme audit
 * dossiers, and phase-specific deploy runbooks. If someone restores them by
 * accident (or re-introduces links to them), this test fails. It also pins
 * that the mandatory pre-launch artifact exists.
 *
 * Invariants:
 *   1) `docs/GLOBAL_LAUNCH_CHECKLIST.md` exists and covers the must-have
 *      sections (smoke gate, locale, hash chain, outbox trigger, metrics).
 *   2) No runnable doc still references a pruned runbook.
 *   3) `docs/runbooks/` stays small (≤ 25 files) so the on-call can actually
 *      read it end-to-end.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// 1) GLOBAL_LAUNCH_CHECKLIST.md exists and is exhaustive
// ---------------------------------------------------------------------------

test('GLOBAL_LAUNCH_CHECKLIST.md exists and covers required sections', () => {
  const path = join(ROOT, 'docs/GLOBAL_LAUNCH_CHECKLIST.md');
  assert.ok(existsSync(path), 'docs/GLOBAL_LAUNCH_CHECKLIST.md must exist');
  const src = readFileSync(path, 'utf8');

  const requiredSections = [
    /Smoke gate/i,
    /Lexicon.*stages/i,
    /Locale neutrality/i,
    /phone hash SSOT/i,
    /Merkle chain|VOID ledger/i,
    /Idempotency/i,
    /outbox trigger/i,
    /Observability/i,
    /Google Ads/i,
    /Canary/i,
    /Post-launch/i,
  ];
  for (const re of requiredSections) {
    assert.match(src, re, `launch checklist missing section matching ${re}`);
  }
  // The checklist must name the mandatory smoke command verbatim so ops can
  // grep for it.
  assert.match(src, /npm run smoke:intent-multi-site/, 'mandatory smoke command missing');
  // And it must call out 2/2 as the only acceptable result.
  assert.match(src, /2\/2 site PASS/i, 'launch checklist must cite the 2/2 PASS gate');
});

// ---------------------------------------------------------------------------
// 2) Pruned docs must stay pruned + no dangling references
// ---------------------------------------------------------------------------

/**
 * Files deleted in Phase 5 f5-docs-cleanup. If any of these reappear, the
 * review should flag the re-introduction — most of them were per-site
 * forensic notes or one-shot audits that do not survive the refactor.
 */
const PRUNED_DOC_PATHS = [
  'docs/runbooks/AZATHOTH_DOSSIER_ELDRITCH_AUDIT.md',
  'docs/runbooks/COSMIC_DOSSIER_ONTOLOGICAL_AUDIT.md',
  'docs/runbooks/DOOMSDAY_DOSSIER_APEX_AUDIT.md',
  'docs/runbooks/EXTINCTION_DOSSIER_ABYSSAL_AUDIT.md',
  'docs/runbooks/OMEGA_DOSSIER_HYPER_REALITY_AUDIT.md',
  'docs/runbooks/SINGULARITY_DOSSIER_EVENT_HORIZON_AUDIT.md',
  'docs/runbooks/CAUSAL_INTEGRITY_REPORT_EVENT_HORIZON_SCAN.md',
  'docs/runbooks/VULNERABILITY_DETERMINISM_REPORT.md',
  'docs/runbooks/SYSTEMIC_ANOMALY_CHRONO_DRIFT_REPORT.md',
  'docs/runbooks/PR_IMPLEMENTATION_REPORT.md',
  'docs/runbooks/ESLAMED_OCI_SCRIPT_ANALYSIS.md',
  'docs/runbooks/ESLAMED_V1_AND_VALUE_OUTBOUND_PROOF.md',
  'docs/runbooks/MURATCAN_CONVERSION_TIME_ROOT_CAUSE.md',
  'docs/runbooks/MURATCAN_ESLAMED_OCI_ANALYSIS.md',
  'docs/runbooks/OCI_ESLAMED_FORENSIC_AUDIT.md',
  'docs/runbooks/OCI_MURATCAN_7_ADVANCED_CONVERSION_ANALYSIS.md',
  'docs/runbooks/OCI_MURATCAN_SCRIPT_REVIEW.md',
  'docs/runbooks/LOCATION_AND_TRAFFIC_INFLATION_ANALYSIS.md',
  'docs/runbooks/TEMP_QUOTA_UNBLOCK_SITES_2026-02-15.md',
  'docs/runbooks/TRT_CUTOFF_DB_RESET_RUNBOOK.md',
  'docs/runbooks/OCI_V3_QUALIFIED_MEETING_VALUE_MATH.md',
  'docs/runbooks/OCI_GCLID_DECODE_FAILED_RESET.md',
  'docs/runbooks/DEPLOY_SYNC_429_SITE_SCOPED_RL.md',
  'docs/runbooks/DEPLOY_SYNC_SMOOTH_LIVE.md',
  'docs/runbooks/OCI_OCCURRED_AT_PHASED_ROLLOUT.md',
  'docs/runbooks/OCI_CHAOS_RED_TEAM_AUDIT.md',
  'docs/runbooks/OCI_KERNEL_ADVERSARIAL_GATE.md',
  'docs/runbooks/QUEUE_NOT_REAL_ATTACK_SCENARIO.md',
  'docs/runbooks/TENANT_BOUNDARY_ADVERSARIAL_GATE.md',
  'docs/runbooks/OCI_FIVE_GEAR_ARCHITECTURAL_AUDIT.md',
  'docs/runbooks/OCI_LOGIC_BUGS_AND_HARDENING_PLAN.md',
  'docs/runbooks/OCI_SEAL_TO_GOOGLE_ADS_TRACE.md',
  'docs/runbooks/OCI_SYSTEM_DEEP_ANALYSIS.md',
  'docs/runbooks/ATTRIBUTION_GEO_FORENSIC_AUDIT.md',
  'docs/runbooks/GCLID_TRACKING_AUDIT.md',
  'docs/runbooks/CONVERSION_DEFAULT_VALUES_RUNBOOK.md',
  'docs/runbooks/CONVERSION_LOGIC_ERRORS_RUNBOOK.md',
  'docs/runbooks/CONVERSION_SIGNAL_STATUS_REPORT.md',
  'docs/runbooks/CHATBOT_GENERIC_PHASE_ENTRYPOINTS.md',
  'docs/runbooks/JUNK_FLOW_DEBUG.md',
  'docs/runbooks/PR_GATE_WATCHTOWER_BUILDINFO.md',
  'docs/runbooks/REVENUE_KERNEL_RELEASE_RUNBOOK.md',
  'docs/runbooks/DEPLOY_CHECKLIST_REVENUE_KERNEL.md',
  'docs/runbooks/INTENT_BUTTONS_OCI_ZERO_VALUE_AND_MANIPULATION_REPORT.md',
  'docs/OPS/PHASE21_STATE_MACHINE_CONSENSUS.md',
  'docs/OPS/LAST_TWO_PROMPTS_REPORT.md',
  'docs/OPS/P0_INTENT_DEBUG_AUDIT.md',
  'docs/OPS/OCI_INTENT_DETERMINISTIC_AUDIT.md',
];

for (const rel of PRUNED_DOC_PATHS) {
  test(`pruned doc stays pruned: ${rel}`, () => {
    const full = join(ROOT, rel);
    assert.ok(
      !existsSync(full),
      `${rel} was deleted in Phase 5 f5-docs-cleanup — do not re-introduce.`
    );
  });
}

test('no active doc links to a pruned runbook', () => {
  const extensions = new Set(['.md']);
  const skip = new Set(['node_modules', '.next', '.git', 'full_dump.txt']);
  const offenders: string[] = [];

  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const dot = entry.name.lastIndexOf('.');
      const ext = dot >= 0 ? entry.name.slice(dot) : '';
      if (!extensions.has(ext)) continue;
      const rel = relative(ROOT, full).replace(/\\/g, '/');
      // Allow the guard test itself to mention the pruned list.
      if (rel === 'tests/architecture/phase5-docs-cleanup.test.ts') continue;
      const src = readFileSync(full, 'utf8');
      for (const pruned of PRUNED_DOC_PATHS) {
        const base = pruned.split('/').pop()!;
        if (src.includes(base)) {
          offenders.push(`${rel} → ${base}`);
        }
      }
    }
  }
  walk(join(ROOT, 'docs'));

  assert.equal(
    offenders.length,
    0,
    `Docs still link to pruned runbooks:\n${offenders.join('\n')}`
  );
});

// ---------------------------------------------------------------------------
// 3) Runbook count stays bounded
// ---------------------------------------------------------------------------

test('docs/runbooks stays under a readable size (<= 25 files)', () => {
  const dir = join(ROOT, 'docs/runbooks');
  const files = readdirSync(dir).filter((f) => {
    const full = join(dir, f);
    return statSync(full).isFile() && f.endsWith('.md');
  });
  assert.ok(
    files.length <= 25,
    `docs/runbooks has ${files.length} files — cap is 25 so on-call can read the whole set before incidents.`
  );
});
