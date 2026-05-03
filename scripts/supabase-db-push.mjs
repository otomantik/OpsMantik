#!/usr/bin/env node
/**
 * Loads .env / .env.local so SUPABASE_DB_PASSWORD is set, then runs Supabase CLI db push.
 * The Supabase CLI does not read .env.local by default — this is why pushes fail in PowerShell.
 *
 * Default behaviour: tries several connection shapes in order until one succeeds:
 *   1) SUPABASE_DB_PUSH_URL if set (paste from Dashboard → Connect; prefer pooler, not `db.*` if DNS fails)
 *   2) SUPABASE_DB_USE_DIRECT_URL=1 → `db.<ref>.supabase.co:5432` (needs IPv6/DNS)
 *   3) Session pooler URI from `supabase/.temp/pooler-url` + password
 *   4) Same host with port 6543 (transaction pooler)
 *   5) Linked project + `--password`
 *
 * Usage:
 *   node scripts/supabase-db-push.mjs
 *   node scripts/supabase-db-push.mjs --include-all
 *   npm run db:push
 *   SUPABASE_DB_USE_DIRECT_URL=1 npm run db:push
 */
import fs from 'node:fs';
import { resolve } from 'node:path';
import {
  loadSupabaseProjectEnv,
  ensureSupabaseDbPassword,
  runSupabaseCliSync,
  exitWithCliCredentialsHelp,
} from './supabase-cli-env.mjs';

function readLinkedProjectRef(root) {
  try {
    return fs.readFileSync(resolve(root, 'supabase', '.temp', 'project-ref'), 'utf8').trim();
  } catch {
    return '';
  }
}

/** Session-style pooler URI from `supabase link` + DB password in the URL. */
function readPoolerDbUrlWithPassword(root, plainPassword) {
  try {
    const raw = fs.readFileSync(resolve(root, 'supabase', '.temp', 'pooler-url'), 'utf8').trim();
    const u = new URL(raw);
    u.password = plainPassword;
    return u.toString();
  } catch {
    return '';
  }
}

const root = process.cwd();
loadSupabaseProjectEnv(root);
if (!ensureSupabaseDbPassword()) exitWithCliCredentialsHelp();

const password = (process.env.SUPABASE_DB_PASSWORD || '').trim();
const extra = process.argv.slice(2);
const cliBase = ['db', 'push', '--yes', ...extra];

function tryPush(label, extraArgs) {
  console.error(`[db:push] ${label}…`);
  return runSupabaseCliSync(root, [...cliBase, ...extraArgs]);
}

const pushUrl = (process.env.SUPABASE_DB_PUSH_URL || '').trim();
if (pushUrl) {
  const { ok, status } = tryPush('SUPABASE_DB_PUSH_URL', ['--db-url', pushUrl]);
  process.exit(ok ? 0 : (status ?? 1));
}

if (process.env.SUPABASE_DB_USE_DIRECT_URL === '1') {
  const ref = readLinkedProjectRef(root);
  if (!ref) {
    console.error(
      'SUPABASE_DB_USE_DIRECT_URL=1 needs supabase/.temp/project-ref (run `supabase link` in this repo).'
    );
    process.exit(1);
  }
  const enc = encodeURIComponent(password);
  const directUrl = `postgresql://postgres:${enc}@db.${ref}.supabase.co:5432/postgres`;
  const { ok, status } = tryPush('direct db.<ref>.supabase.co', ['--db-url', directUrl]);
  process.exit(ok ? 0 : (status ?? 1));
}

const sessionPooler = readPoolerDbUrlWithPassword(root, password);
if (sessionPooler) {
  let r = tryPush('session pooler (from supabase link)', ['--db-url', sessionPooler]);
  if (r.ok) process.exit(0);
  try {
    const u = new URL(sessionPooler);
    u.port = '6543';
    r = tryPush('transaction pooler :6543', ['--db-url', u.toString()]);
    if (r.ok) process.exit(0);
  } catch {
    /* ignore malformed pooler-url */
  }
}

const last = tryPush('linked project + --password', ['--password', password]);
process.exit(last.ok ? 0 : (last.status ?? 1));
