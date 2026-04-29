#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../..');

const DEFAULT_OUTPUT = join(repoRoot, 'tmp', 'release-gates-latest.md');
const COMMANDS_BY_MODE = {
  pr: [
    'node scripts/ci/verify-db.mjs',
    'npm run test:tenant-boundary',
    'npm run test:oci-kernel',
  ],
  // Must mirror package.json `test:release-gates` (evidence parity gate)
  full: [
    'node scripts/ci/verify-db.mjs',
    'npm run test:tenant-boundary',
    'npm run test:oci-kernel',
    'npm run test:runtime-budget',
    'npm run test:chaos-core',
    'npm run smoke:intent-multi-site',
    'npm run smoke:oci-rollout-readiness:strict',
  ],
};

function parseArgs(argv) {
  let output = DEFAULT_OUTPUT;
  let mode = 'full';
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
    if (arg.startsWith('--output=')) {
      output = resolve(repoRoot, arg.slice('--output='.length));
      continue;
    }
    if (arg.startsWith('--mode=')) {
      mode = arg.slice('--mode='.length) || mode;
    }
  }
  if (!(mode in COMMANDS_BY_MODE)) {
    console.error(`Unsupported mode: ${mode}`);
    process.exit(1);
  }
  return { output, mode };
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
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  return {
    command,
    startedAt,
    durationMs,
    exitCode: result.status ?? 1,
    ok: (result.status ?? 1) === 0,
    output: [stdout, stderr].filter(Boolean).join(stdout && stderr ? '\n' : ''),
  };
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

function summarizeOutput(output, ok) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const summaryLines = [];
  const testsLine = lines.find((line) => /^# tests \d+$/i.test(line));
  const passLine = lines.find((line) => /^# pass \d+$/i.test(line));
  const failLine = lines.find((line) => /^# fail \d+$/i.test(line));
  const sitePassLine = lines.find((line) => /\bsite PASS\b/i.test(line));

  if (testsLine) summaryLines.push(testsLine);
  if (passLine) summaryLines.push(passLine);
  if (failLine) summaryLines.push(failLine);
  if (sitePassLine) summaryLines.push(sitePassLine);

  if (summaryLines.length > 0) {
    return summaryLines.join(' | ');
  }

  const fallback = lines.slice(-5).join(' | ');
  return fallback || (ok ? 'command passed' : 'command failed');
}

function buildMarkdown({ generatedAt, commit, branch, nodeVersion, results, commands, mode }) {
  const overallOk = results.every((result) => result.ok);
  const statusLabel = overallOk ? 'PASS' : 'FAIL';
  const commandList = commands.map((command) => `- \`${command}\``).join('\n');
  const sections = results
    .map((result) => {
      const status = result.ok ? 'PASS' : 'FAIL';
      const summary = summarizeOutput(result.output, result.ok);
      return [
        `## ${result.command}`,
        '',
        `- Status: **${status}**`,
        `- Started at: \`${result.startedAt}\``,
        `- Duration: \`${result.durationMs}ms\``,
        `- Exit code: \`${result.exitCode}\``,
        `- Summary: ${summary}`,
        '',
        '```text',
        result.output.trim() || '(no output)',
        '```',
      ].join('\n');
    })
    .join('\n\n');

  return [
    '# Release Gate Evidence',
    '',
    `- Generated at: \`${generatedAt}\``,
    `- Overall status: **${statusLabel}**`,
    `- Mode: \`${mode}\``,
    `- Git branch: \`${branch}\``,
    `- Git commit: \`${commit}\``,
    `- Node: \`${nodeVersion}\``,
    '',
    '## Included Commands',
    '',
    commandList,
    '',
    '## Results',
    '',
    sections,
    '',
  ].join('\n');
}

function main() {
  const { output, mode } = parseArgs(process.argv.slice(2));
  const commands = COMMANDS_BY_MODE[mode];
  const generatedAt = new Date().toISOString();
  const commit = captureShort('git rev-parse --short HEAD');
  const branch = captureShort('git branch --show-current');
  const nodeVersion = captureShort('node --version');

  console.log(`Collecting release gate evidence (${mode})...`);
  const results = commands.map((command) => {
    console.log(`\n> ${command}`);
    return runCommand(command);
  });

  const markdown = buildMarkdown({
    generatedAt,
    commit,
    branch,
    nodeVersion,
    results,
    commands,
    mode,
  });

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, markdown, 'utf8');

  const relativeOutput = relative(repoRoot, output) || output;
  const overallOk = results.every((result) => result.ok);
  console.log(`\nRelease gate evidence written to ${relativeOutput}`);

  if (!overallOk) {
    process.exit(1);
  }
}

main();
