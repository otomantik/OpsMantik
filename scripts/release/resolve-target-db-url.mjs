/**
 * PR-9H.7F — Prefer Transaction Pooler / pooled DSN over direct db.* host when both exist,
 * to reduce DNS/connect failures in local evidence runs.
 */

import { config as loadEnv } from 'dotenv';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function isLikelyPlaceholderValue(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return false;
  return (
    v.includes('<') ||
    v.includes('>') ||
    v.includes('buraya') ||
    v.includes('staging_supabase_db_url') ||
    v.includes('redacted') ||
    /\bexample\.(com|org)\b/i.test(String(raw || '')) ||
    v.startsWith('postgresql://example') ||
    v.startsWith('postgres://example')
  );
}

/**
 * First non-empty, non-placeholder candidate wins.
 * Order: explicit pooler → pooled aliases → legacy direct URLs.
 */
export function resolveTargetDbConnectionString(env = process.env) {
  const keys = [
    'SUPABASE_DB_POOLER_URL',
    'DATABASE_POOLER_URL',
    'SUPABASE_POOLER_URL',
    'SUPABASE_TRANSACTION_POOLER_URL',
    'SUPABASE_DATABASE_URL',
    'SUPABASE_DB_URL',
    'DATABASE_URL',
  ];
  for (const k of keys) {
    const v = String(env[k] ?? '').trim();
    if (v && !isLikelyPlaceholderValue(v)) return v;
  }
  return '';
}

/** @param {string | undefined} input */
export function redactDbConnectionTarget(input) {
  if (!input) return 'none';
  try {
    const u = new URL(input);
    const host = u.hostname || 'unknown-host';
    const port = u.port ? `:${u.port}` : '';
    return `${u.protocol}//${host}${port}`;
  } catch {
    return 'redacted';
  }
}

/**
 * Which env key `resolveTargetDbConnectionString` would use (for diagnostics).
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveTargetDbConnectionKey(env = process.env) {
  const keys = [
    'SUPABASE_DB_POOLER_URL',
    'DATABASE_POOLER_URL',
    'SUPABASE_POOLER_URL',
    'SUPABASE_TRANSACTION_POOLER_URL',
    'SUPABASE_DATABASE_URL',
    'SUPABASE_DB_URL',
    'DATABASE_URL',
  ];
  for (const k of keys) {
    const v = String(env[k] ?? '').trim();
    if (v && !isLikelyPlaceholderValue(v)) return k;
  }
  return null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function runResolverCli() {
  const repoRoot = join(__dirname, '..', '..');
  loadEnv({ path: join(repoRoot, '.env.local') });
  const selectedKey = resolveTargetDbConnectionKey();
  const url = resolveTargetDbConnectionString();
  const targetRedacted = redactDbConnectionTarget(url);
  let hostname = '';
  try {
    hostname = url ? new URL(url).hostname : '';
  } catch {
    hostname = '';
  }
  const hostLooksPooler =
    Boolean(hostname) &&
    (hostname.includes('pooler') || hostname.includes('pooler.supabase') || /:6543\b/.test(url || ''));
  // eslint-disable-next-line no-console -- CLI diagnostic
  console.log(
    JSON.stringify(
      {
        selected_env_key: selectedKey,
        target_redacted: targetRedacted,
        host_looks_like_pooler: hostLooksPooler,
        empty: !url,
      },
      null,
      2
    )
  );
}

try {
  const entry = process.argv[1];
  if (entry && import.meta.url === pathToFileURL(resolve(entry)).href) {
    runResolverCli();
  }
} catch {
  /* not direct CLI */
}
