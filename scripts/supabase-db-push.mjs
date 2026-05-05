#!/usr/bin/env node
/**
 * DDL migrations for this project are applied only via Cursor Supabase MCP
 * (`apply_migration` for versioned migrations, `execute_sql` for ad-hoc DML).
 *
 * Do not run `supabase db push` from CI or laptops against the shared database:
 * the repo stays the source of truth under `supabase/migrations/`; operators apply
 * new files through MCP after merge.
 *
 * If you truly need a local CLI push (unsupported default), set:
 *   ALLOW_SUPABASE_CLI_DB_PUSH=1
 * and ensure you are not overwriting team MCP-only policy.
 */
import process from 'node:process';

if (process.env.ALLOW_SUPABASE_CLI_DB_PUSH === '1' || process.env.ALLOW_SUPABASE_CLI_DB_PUSH === 'true') {
  const { loadSupabaseProjectEnv, ensureSupabaseDbPassword, runSupabaseCliSync, exitWithCliCredentialsHelp } =
    await import('./supabase-cli-env.mjs');
  const fs = await import('node:fs');
  const { resolve } = await import('node:path');

  const root = process.cwd();
  loadSupabaseProjectEnv(root);
  if (!ensureSupabaseDbPassword()) exitWithCliCredentialsHelp();

  const password = (process.env.SUPABASE_DB_PASSWORD || '').trim();
  const extra = process.argv.slice(2);
  const cliBase = ['db', 'push', '--yes', ...extra];

  function readLinkedProjectRef(r) {
    try {
      return fs.readFileSync(resolve(r, 'supabase', '.temp', 'project-ref'), 'utf8').trim();
    } catch {
      return '';
    }
  }

  function readPoolerDbUrlWithPassword(r, plainPassword) {
    try {
      const raw = fs.readFileSync(resolve(r, 'supabase', '.temp', 'pooler-url'), 'utf8').trim();
      const u = new URL(raw);
      u.password = plainPassword;
      return u.toString();
    } catch {
      return '';
    }
  }

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
      /* ignore */
    }
  }

  const last = tryPush('linked project + --password', ['--password', password]);
  process.exit(last.ok ? 0 : (last.status ?? 1));
}

console.error(`
[db:push] Disabled by project policy.

Schema changes must be committed as files under supabase/migrations/ and applied
to the database only through Cursor Supabase MCP:
  • apply_migration — name (snake_case) + full SQL body
  • execute_sql — for non-DDL / one-off fixes only

Do not use supabase db push for this project unless ALLOW_SUPABASE_CLI_DB_PUSH=1
is explicitly set (escape hatch; not the default workflow).

Migration history drift policy:
  docs/OPS/SUPABASE_MIGRATION_DRIFT_POLICY.md
`.trim());
process.exit(1);
