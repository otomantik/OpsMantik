/**
 * Regression lock: forbid direct client reads from public.sessions in dashboard code.
 *
 * Fails if any file under:
 * - components/dashboard/
 * - lib/hooks/
 *
 * contains: .from('sessions') or .from("sessions")
 *
 * Usage:
 *   node scripts/check-no-direct-sessions-access.mjs
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();

const TARGET_DIRS = [
  path.join(repoRoot, 'components', 'dashboard'),
  path.join(repoRoot, 'lib', 'hooks'),
];

// Allowlist (server-only) paths if ever needed.
// Keep empty by default to remain strict.
const ALLOWLIST_SUBSTRINGS = [
  // e.g. path.join(repoRoot, 'lib', 'supabase', 'server.ts'),
];

const PATTERN = /\.from\(\s*['"]sessions['"]\s*\)/g;

async function listFilesRecursive(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...await listFilesRecursive(full));
    } else if (ent.isFile()) {
      if (full.endsWith('.ts') || full.endsWith('.tsx') || full.endsWith('.js') || full.endsWith('.mjs')) {
        out.push(full);
      }
    }
  }
  return out;
}

function isAllowlisted(filePath) {
  return ALLOWLIST_SUBSTRINGS.some((s) => filePath.includes(s));
}

function formatRel(p) {
  return path.relative(repoRoot, p).replace(/\\/g, '/');
}

async function main() {
  const offenders = [];

  for (const dir of TARGET_DIRS) {
    let files = [];
    try {
      files = await listFilesRecursive(dir);
    } catch {
      // If directory doesn't exist, ignore (keeps script portable).
      continue;
    }

    for (const file of files) {
      if (isAllowlisted(file)) continue;
      const text = await fs.readFile(file, 'utf8');
      const matches = [...text.matchAll(PATTERN)];
      if (matches.length > 0) {
        offenders.push({
          file,
          count: matches.length,
        });
      }
    }
  }

  if (offenders.length > 0) {
    console.error('❌ Regression lock failed: direct sessions access detected.');
    for (const o of offenders) {
      console.error(`- ${formatRel(o.file)} (${o.count} match${o.count === 1 ? '' : 'es'})`);
    }
    console.error("\nFix: replace direct `.from('sessions')` calls with RPCs or server-only routes.");
    process.exit(1);
  }

  console.log("✅ Regression lock PASS: no `.from('sessions')` usage in dashboard components/hooks.");
}

main().catch((err) => {
  console.error('❌ Regression lock error:', err?.message || err);
  process.exit(1);
});

