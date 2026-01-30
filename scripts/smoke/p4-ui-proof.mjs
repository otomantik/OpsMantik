/**
 * P4-2 UI proof: wiring + optional screenshot.
 * 1) Asserts BreakdownWidgets + hook + DashboardShell integration exist.
 * 2) Exits 0 on PASS (wiring). Run p4-ui-screenshot.mjs separately for screenshot (requires app running).
 * Usage: node scripts/smoke/p4-ui-proof.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function assertFileExists(relPath) {
  const p = path.join(root, relPath);
  if (!fs.existsSync(p)) throw new Error(`Missing file: ${relPath}`);
}

function fileContains(relPath, substring) {
  const p = path.join(root, relPath);
  const content = fs.readFileSync(p, 'utf8');
  if (!content.includes(substring)) throw new Error(`${relPath} does not contain "${substring}"`);
}

const report = [];

try {
  assertFileExists('lib/hooks/use-dashboard-breakdown.ts');
  report.push('OK lib/hooks/use-dashboard-breakdown.ts');
} catch (e) {
  report.push(`FAIL ${e.message}`);
}

try {
  assertFileExists('components/dashboard-v2/widgets/BreakdownWidgets.tsx');
  report.push('OK components/dashboard-v2/widgets/BreakdownWidgets.tsx');
} catch (e) {
  report.push(`FAIL ${e.message}`);
}

try {
  assertFileExists('components/dashboard-v2/widgets/SourceBreakdownCard.tsx');
  assertFileExists('components/dashboard-v2/widgets/LocationBreakdownCard.tsx');
  assertFileExists('components/dashboard-v2/widgets/DeviceBreakdownCard.tsx');
  report.push('OK breakdown cards exist');
} catch (e) {
  report.push(`FAIL ${e.message}`);
}

try {
  fileContains('components/dashboard-v2/DashboardShell.tsx', 'BreakdownWidgets');
  report.push('OK DashboardShell imports BreakdownWidgets');
} catch (e) {
  report.push(`FAIL ${e.message}`);
}

try {
  fileContains('components/dashboard-v2/DashboardShell.tsx', 'overflow-x-hidden');
  report.push('OK DashboardShell has overflow-x-hidden');
} catch (e) {
  report.push(`FAIL ${e.message}`);
}

const failed = report.filter((r) => r.startsWith('FAIL'));
if (failed.length > 0) {
  report.forEach((r) => console.log(r));
  console.error('P4-2 UI proof: FAIL');
  process.exit(1);
}

report.forEach((r) => console.log(r));
console.log('P4-2 UI proof: PASS (wiring). Run node scripts/smoke/p4-ui-screenshot.mjs for screenshot (app must be running).');
process.exit(0);
