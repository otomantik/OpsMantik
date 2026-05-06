#!/usr/bin/env node
import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { config as loadEnv } from 'dotenv';
import {
  EVIDENCE_CONTRACT_VERSION,
  MODE_CONFIG,
  REASON_CODES,
  buildScorecardMarkdown,
  hashFile,
  normalizeEvidenceArtifact,
  resolveSqlPackAbsPaths,
} from './evidence-contracts.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../..');
loadEnv({ path: join(repoRoot, '.env.local') });

const DEFAULT_OUTPUT = join(repoRoot, 'tmp', 'release-gates-latest.md');
const MODE_ALIASES = { pr: 'static', full: 'production' };

const MODE_COMMANDS = {
  static: ['node scripts/release/verify-health-pack-contracts.mjs', 'npm run test:tenant-boundary', 'npm run test:oci-kernel'],
  local: ['node scripts/release/verify-health-pack-contracts.mjs', 'npm run test:tenant-boundary', 'npm run test:oci-kernel'],
  staging: [
    'node scripts/release/verify-health-pack-contracts.mjs',
    'node scripts/ci/verify-db.mjs',
    'npm run test:tenant-boundary',
    'npm run test:oci-kernel',
    'npm run test:runtime-budget',
    'npm run test:chaos-core',
    'npm run smoke:oci-rollout-readiness:strict',
  ],
  production: [
    'node scripts/release/verify-health-pack-contracts.mjs',
    'node scripts/ci/verify-db.mjs',
    'npm run test:tenant-boundary',
    'npm run test:oci-kernel',
    'npm run test:runtime-budget',
    'npm run test:chaos-core',
    'npm run smoke:oci-rollout-readiness:strict',
  ],
};

function getModeCommands(mode) {
  if (process.env.EVIDENCE_TEST_FAST === '1') {
    return ['node scripts/release/verify-health-pack-contracts.mjs'];
  }
  return MODE_COMMANDS[mode];
}

function parseArgs(argv) {
  let output = DEFAULT_OUTPUT;
  let mode = 'static';
  let environment = process.env.EVIDENCE_ENVIRONMENT || '';
  let withDb = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--output') {
      output = resolve(repoRoot, argv[i + 1] || '');
      i += 1;
      continue;
    }
    if (arg === '--mode') {
      mode = argv[i + 1] || mode;
      i += 1;
      continue;
    }
    if (arg === '--environment') {
      environment = argv[i + 1] || environment;
      i += 1;
      continue;
    }
    if (arg.startsWith('--output=')) output = resolve(repoRoot, arg.slice('--output='.length));
    if (arg.startsWith('--mode=')) mode = arg.slice('--mode='.length) || mode;
    if (arg.startsWith('--environment=')) environment = arg.slice('--environment='.length) || environment;
    if (arg === '--with-db') withDb = true;
  }
  mode = MODE_ALIASES[mode] ?? mode;
  if (!(mode in MODE_CONFIG)) {
    return { ok: false, error_code: REASON_CODES.UNKNOWN_MODE, output, mode, environment, withDb };
  }
  return { ok: true, output, mode, environment: environment || mode, withDb };
}

function captureShort(command) {
  const result = spawnSync(command, {
    cwd: repoRoot,
    shell: true,
    encoding: 'utf8',
    env: process.env,
  });
  return (result.stdout || '').trim() || (result.stderr || '').trim() || 'unknown';
}

function runCommand(command) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const result = spawnSync(command, {
    cwd: repoRoot,
    shell: true,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  const durationMs = Date.now() - startedMs;
  return {
    name: command,
    started_at: startedAt,
    duration_ms: durationMs,
    exit_code: result.status ?? 1,
    status: (result.status ?? 1) === 0 ? 'PASS' : 'FAIL',
    output: `${result.stdout || ''}${result.stderr || ''}`.trim(),
    reason_code: (result.status ?? 1) === 0 ? null : REASON_CODES.RED_METRIC,
  };
}

function buildMarkdown(artifact) {
  return [
    '# Release Gate Evidence',
    '',
    `- overall_status: **${artifact.overall_status}**`,
    `- mode: \`${artifact.metadata.mode}\``,
    `- environment: \`${artifact.metadata.environment}\``,
    `- evidence_contract: \`${artifact.metadata.contract_version}\``,
    `- generated_at: \`${artifact.metadata.generated_at}\``,
    `- git_commit: \`${artifact.metadata.git_commit}\``,
    `- actor: \`${artifact.metadata.actor}\``,
    `- db_checked: \`${artifact.metadata.db_checked}\``,
    `- db_claim_scope: \`${artifact.metadata.db_claim_scope}\``,
    '',
    '## SQL Pack Hashes',
    '',
    ...artifact.metadata.sql_pack_hashes.map(
      (p) => `- ${p.pack_id}: \`${p.sha256.slice(0, 12)}...\` (\`${p.contract_version}\`)`
    ),
    '',
    '## Summary',
    '',
    `- total_checks: ${artifact.summary.total_checks}`,
    `- passed_checks: ${artifact.summary.passed_checks}`,
    `- failed_checks: ${artifact.summary.failed_checks}`,
    `- skipped_checks: ${artifact.summary.skipped_checks}`,
    `- blocking_failures: ${artifact.summary.blocking_failures}`,
    '',
    '## Check Results',
    '',
    ...artifact.checks.map(
      (c) =>
        `- ${c.name}: ${c.status}${c.reason_code ? ` (\`${c.reason_code}\`)` : ''}${
          c.skipped_reason ? ` [skipped_reason=${c.skipped_reason}]` : ''
        }`
    ),
    '',
    '## Metadata (JSON)',
    '```json',
    JSON.stringify(artifact, null, 2),
    '```',
    '',
  ].join('\n');
}

function dbEnvAvailable() {
  return Boolean((process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const commit = captureShort('git rev-parse --short HEAD');
  const branch = captureShort('git branch --show-current');
  const nodeVersion = captureShort('node --version');
  const actor = process.env.GITHUB_ACTOR || process.env.OPERATOR_ID || process.env.USERNAME || 'unknown';

  const packs = resolveSqlPackAbsPaths(repoRoot);
  const sqlPackHashes = packs.map((p) => ({
    pack_id: p.pack_id,
    contract_version: p.contract_version,
    sha256: hashFile(p.absPath),
  }));

  const checks = [];
  const blockingFailures = [];
  const warnings = [];

  if (!parsed.ok) {
    blockingFailures.push({ reason_code: parsed.error_code, message: `Unsupported mode ${parsed.mode}` });
  } else {
    const modeRules = MODE_CONFIG[parsed.mode];
    const dbAvailable = dbEnvAvailable();
    const commands = [...getModeCommands(parsed.mode)];

    if (!modeRules.db_required && !modeRules.db_optional) {
      checks.push({
        name: 'db-preflight',
        status: 'SKIPPED',
        reason_code: REASON_CODES.DB_NOT_REQUIRED_FOR_MODE,
        skipped_reason: REASON_CODES.DB_NOT_REQUIRED_FOR_MODE,
        started_at: generatedAt,
        duration_ms: 0,
      });
      for (const command of commands.filter((c) => !c.includes('verify-db'))) {
        checks.push(runCommand(command));
      }
    } else if (!dbAvailable && modeRules.db_required) {
      blockingFailures.push({
        reason_code: REASON_CODES.MISSING_ENV,
        message: 'DB-required mode missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY',
      });
    } else {
      if (modeRules.db_optional && !parsed.withDb) {
        checks.push({
          name: 'db-preflight',
          status: 'SKIPPED',
          reason_code: REASON_CODES.DB_NOT_REQUIRED_FOR_MODE,
          skipped_reason: REASON_CODES.DB_NOT_REQUIRED_FOR_MODE,
          started_at: generatedAt,
          duration_ms: 0,
        });
        commands.splice(commands.indexOf('node scripts/ci/verify-db.mjs'), 1);
      } else if (!dbAvailable && modeRules.db_optional) {
        checks.push({
          name: 'db-preflight',
          status: 'SKIPPED',
          reason_code: REASON_CODES.DB_NOT_REQUIRED_FOR_MODE,
          skipped_reason: REASON_CODES.DB_NOT_REQUIRED_FOR_MODE,
          started_at: generatedAt,
          duration_ms: 0,
        });
        commands.splice(commands.indexOf('node scripts/ci/verify-db.mjs'), 1);
      } else {
        checks.push(runCommand('node scripts/ci/verify-db.mjs'));
      }
      for (const command of commands.filter((c) => c !== 'node scripts/ci/verify-db.mjs')) {
        checks.push(runCommand(command));
      }
    }
  }

  for (const c of checks) {
    if (c.status === 'FAIL') {
      blockingFailures.push({ reason_code: c.reason_code || REASON_CODES.RED_METRIC, message: c.name });
    }
  }

  const artifact = {
    metadata: {
      contract_version: EVIDENCE_CONTRACT_VERSION,
      mode: parsed.mode,
      environment: parsed.environment,
      generated_at: generatedAt,
      git_commit: commit,
      git_branch: branch,
      node_version: nodeVersion,
      actor,
      command_invoked: `node scripts/release/collect-gate-evidence.mjs --mode=${parsed.mode}${parsed.withDb ? ' --with-db' : ''}`,
      db_checked: checks.some((c) => c.name.includes('verify-db')),
      db_target: parsed.mode,
      db_claim_scope: checks.some((c) => c.name.includes('verify-db')) ? 'full' : 'none',
      normalization_version: 'v1',
      sql_pack_hashes: sqlPackHashes,
    },
    checks,
    summary: {
      total_checks: checks.length,
      passed_checks: checks.filter((c) => c.status === 'PASS').length,
      failed_checks: checks.filter((c) => c.status === 'FAIL').length,
      skipped_checks: checks.filter((c) => c.status === 'SKIPPED').length,
      blocking_failures: blockingFailures.length,
      warnings: warnings.length,
    },
    blocking_failures: blockingFailures,
    warnings,
    overall_status: blockingFailures.length === 0 ? (warnings.length ? REASON_CODES.PASS_WITH_WARNINGS : 'PASS') : 'FAIL',
  };

  const markdown = buildMarkdown(artifact);
  mkdirSync(dirname(parsed.output ?? DEFAULT_OUTPUT), { recursive: true });
  writeFileSync(parsed.output ?? DEFAULT_OUTPUT, markdown, 'utf8');
  writeFileSync(join(repoRoot, 'tmp', 'release-gates-normalized.json'), normalizeEvidenceArtifact(artifact), 'utf8');
  writeFileSync(
    join(repoRoot, 'tmp', 'release-evidence-scorecard.md'),
    buildScorecardMarkdown({ artifact, outputPath: relative(repoRoot, parsed.output ?? DEFAULT_OUTPUT) || parsed.output }),
    'utf8'
  );

  console.log(`Release gate evidence written to ${relative(repoRoot, parsed.output ?? DEFAULT_OUTPUT)}`);
  if (artifact.overall_status === 'FAIL') process.exit(1);
}

main();
