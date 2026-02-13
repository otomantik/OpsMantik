#!/usr/bin/env node
/**
 * CI Regression Lock: fail if service-role `adminClient` queries tenant-scoped tables
 * without explicit tenant scoping.
 *
 * Scans:
 * - app/api/**
 * - lib/**
 * - scripts/**
 *
 * Allowlist:
 * - scripts/audit/tenant-scope-allowlist.json
 *
 * Optional CLI:
 * - --extra-path <path>   (repeatable) scan additional path(s) (used by unit test fixtures)
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const DEFAULT_SCAN_DIRS = ['app/api', 'lib', 'scripts'].map((p) => path.join(repoRoot, p));

function toRel(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

function parseArgs(argv) {
  const extraPaths = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--extra-path') {
      const v = argv[i + 1];
      if (v) extraPaths.push(path.resolve(process.cwd(), v));
      i++;
    }
  }
  return { extraPaths };
}

function loadAllowlist() {
  const p = path.join(__dirname, 'tenant-scope-allowlist.json');
  if (!existsSync(p)) return [];
  try {
    const raw = readFileSync(p, 'utf8');
    const json = JSON.parse(raw);
    return Array.isArray(json) ? json : [];
  } catch {
    return [];
  }
}

const allowlist = loadAllowlist();
const allowSet = new Set(allowlist.map((e) => `${e.file}::${e.table}`));

function isAllowed(relFile, table) {
  return allowSet.has(`${relFile}::${table}`);
}

function isCodeFile(name) {
  return (
    name.endsWith('.ts') ||
    name.endsWith('.tsx') ||
    name.endsWith('.js') ||
    name.endsWith('.jsx') ||
    name.endsWith('.mjs') ||
    name.endsWith('.cjs')
  );
}

function walk(dir, out) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next' || e.name.startsWith('.')) continue;
      walk(full, out);
    } else if (e.isFile() && isCodeFile(e.name)) {
      out.push(full);
    }
  }
}

// Tenant-scoped tables (starting set; extend as needed)
function normalizeTable(t) {
  // treat partitions as their base tables
  if (t.startsWith('sessions_')) return 'sessions';
  if (t.startsWith('events_')) return 'events';
  return t;
}

const TENANT_TABLES = new Set([
  'sites',
  'site_members',
  'sessions',
  'events',
  'calls',
  'intents',
  'processed_signals',
  'ingest_publish_failures',
  'sync_dlq',
  'sync_dlq_replay_audit',
]);

function scopeOkForSites(stmt) {
  // `sites` has no site_id column; allow scoping by id/public_id/user_id.
  return (
    /\.eq\(\s*['"]id['"]/.test(stmt) ||
    /\.in\(\s*['"]id['"]/.test(stmt) ||
    /\.eq\(\s*['"]public_id['"]/.test(stmt) ||
    /\.in\(\s*['"]public_id['"]/.test(stmt) ||
    /\.eq\(\s*['"]user_id['"]/.test(stmt) ||
    /\.in\(\s*['"]user_id['"]/.test(stmt)
  );
}

function scopeOkBySiteId(stmt) {
  return /\.eq\(\s*['"]site_id['"]/.test(stmt) || /\.in\(\s*['"]site_id['"]/.test(stmt);
}

function scopeOkBySitePublicId(stmt) {
  return /\.eq\(\s*['"]site_public_id['"]/.test(stmt) || /\.in\(\s*['"]site_public_id['"]/.test(stmt) || /site_public_id\s*:/.test(stmt);
}

function scopeOkForEvents(stmt) {
  // Preferred: site_id scope. Allowed fallback: session_id + session_month (partition+FK-friendly).
  if (scopeOkBySiteId(stmt)) return true;
  const hasSessionId = /\.eq\(\s*['"]session_id['"]/.test(stmt);
  const hasSessionMonth = /\.eq\(\s*['"]session_month['"]/.test(stmt) || /\.eq\(\s*['"]session_month['"]/.test(stmt);
  return hasSessionId && hasSessionMonth;
}

function scopeOkForInsertPayload(stmt) {
  // For INSERT/UPSERT, scoping may be in payload rather than filters.
  return /site_id\s*:/.test(stmt) || /site_public_id\s*:/.test(stmt);
}

function extractInsertArg(stmt, methodName) {
  const idx = stmt.indexOf(`.${methodName}(`);
  if (idx === -1) return null;
  const start = idx + methodName.length + 2; // ".insert(" length includes "."
  let depth = 0;
  for (let i = start; i < stmt.length; i++) {
    const ch = stmt[i];
    if (ch === '(') depth++;
    if (ch === ')') {
      if (depth === 0) {
        return stmt.slice(start, i).trim();
      }
      depth--;
    }
  }
  return null;
}

function firstArgToken(argExpr) {
  if (!argExpr) return null;
  // Split on comma at top-level (best-effort) and take the first chunk.
  const first = argExpr.split(',')[0].trim();
  if (!first) return null;
  // If it's wrapped in parentheses, strip one layer.
  const unwrapped = first.startsWith('(') && first.endsWith(')') ? first.slice(1, -1).trim() : first;
  return unwrapped;
}

function isSimpleIdentifier(x) {
  return /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(x);
}

function payloadIdentifierHasSiteKey(src, ident, fromLine, depth = 0) {
  if (depth > 3) return false;
  // Best-effort local heuristic: search backwards for `const ident = { ... site_id: ... }`
  // within a small window above the statement.
  const lines = src.split('\n');
  const start = Math.max(0, fromLine - 120);
  const end = Math.min(lines.length, fromLine + 5);
  const window = lines.slice(start, end).join('\n');

  // Look for a nearby object literal assignment to that identifier.
  // Allow optional TS type annotation: `const x: SomeType = { ... }`
  const re = new RegExp(`\\b(const|let)\\s+${ident}(?:\\s*:\\s*[^=]+)?\\s*=\\s*\\{[\\s\\S]{0,2500}?\\}`, 'm');
  const m = re.exec(window);
  if (!m) return false;
  const obj = m[0];
  if (/site_id\s*:/.test(obj) || /site_public_id\s*:/.test(obj)) return true;

  // Handle simple spread-chains: if this object spreads another object, recurse.
  const spreadRe = /\.\.\.\s*([A-Za-z_$][0-9A-Za-z_$]*)/g;
  let sm;
  while ((sm = spreadRe.exec(obj))) {
    const child = sm[1];
    if (child && child !== ident) {
      if (payloadIdentifierHasSiteKey(src, child, fromLine, depth + 1)) return true;
    }
  }

  return false;
}

function findStatement(src, startIdx) {
  const semi = src.indexOf(';', startIdx);
  if (semi === -1) return src.slice(startIdx);
  return src.slice(startIdx, semi + 1);
}

function lineNumberForIndex(src, idx) {
  // 1-based line number
  return src.slice(0, idx).split('\n').length;
}

function analyzeFile(filePath) {
  const rel = toRel(filePath);
  const src = readFileSync(filePath, 'utf8');

  const findings = [];
  const re = /adminClient\.from\(\s*(['"`])([^'"`]+)\1\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const rawTable = m[2];
    const table = normalizeTable(rawTable);
    if (!TENANT_TABLES.has(table)) continue;
    if (isAllowed(rel, table)) continue;

    const stmt = findStatement(src, m.index);
    const line = lineNumberForIndex(src, m.index);

    // IMPORTANT: Supabase insert/upsert chains often include `.select()` after the write.
    // Detect write operations first to avoid misclassifying writes as reads.
    const op =
      stmt.includes('.insert(') ? 'insert'
      : stmt.includes('.upsert(') ? 'upsert'
      : stmt.includes('.update(') ? 'update'
      : stmt.includes('.delete(') ? 'delete'
      : stmt.includes('.select(') ? 'select'
      : 'unknown';

    let ok = false;
    let reason = '';

    if (table === 'sites') {
      ok = scopeOkForSites(stmt) || scopeOkForInsertPayload(stmt);
      if (!ok) reason = 'missing site scope (sites requires eq/in on id/public_id/user_id)';
    } else if (table === 'ingest_publish_failures') {
      ok = scopeOkBySitePublicId(stmt);
      if (!ok) reason = 'missing site scope (ingest_publish_failures requires site_public_id scope/payload)';
    } else if (table === 'events') {
      ok = scopeOkForEvents(stmt) || (op === 'insert' || op === 'upsert' ? scopeOkForInsertPayload(stmt) : false);
      if (!ok) reason = 'missing tenant scope (events requires site_id OR session_id+session_month)';
    } else if (op === 'insert' || op === 'upsert') {
      ok = scopeOkBySiteId(stmt) || scopeOkForInsertPayload(stmt);
      if (!ok) {
        // If insert/upsert uses an identifier (e.g. insert(baseInsert)), try to resolve the object literal nearby.
        const argExpr = extractInsertArg(stmt, op);
        const tok = firstArgToken(argExpr);
        if (tok && isSimpleIdentifier(tok)) {
          ok = payloadIdentifierHasSiteKey(src, tok, line);
        }
      }
      if (!ok) reason = 'missing tenant scope (insert/upsert must include site_id in payload or filter)';
    } else {
      ok = scopeOkBySiteId(stmt);
      if (!ok) reason = 'missing tenant scope (expected .eq/.in on site_id in chain)';
    }

    if (!ok) {
      findings.push({
        file: rel,
        line,
        table,
        reason,
      });
    }
  }
  return findings;
}

function main() {
  const { extraPaths } = parseArgs(process.argv.slice(2));
  const dirs = [...DEFAULT_SCAN_DIRS, ...extraPaths];

  const files = [];
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    walk(d, files);
  }

  const violations = [];
  for (const f of files) {
    try {
      violations.push(...analyzeFile(f));
    } catch {
      // ignore unreadable files
    }
  }

  if (violations.length) {
    console.error('❌ TENANT SCOPE AUDIT FAILED: adminClient used without explicit tenant scoping');
    console.error('');
    for (const v of violations) {
      console.error(`- ${v.file}:${v.line}`);
      console.error(`  table: ${v.table}`);
      console.error(`  reason: ${v.reason}`);
    }
    console.error('');
    console.error('💡 Fix: add explicit scope (site_id/site_public_id) OR add a justified allowlist entry.');
    process.exit(1);
  }

  console.log('✅ TENANT SCOPE AUDIT PASSED');
}

main();

