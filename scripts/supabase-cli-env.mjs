/**
 * Loads .env / .env.local for Supabase CLI (which does not read .env.local by default).
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { config } from 'dotenv';

export function loadSupabaseProjectEnv(root = process.cwd()) {
  config({ path: resolve(root, '.env') });
  // Local overrides base (CLI password should live here, not checked in).
  config({ path: resolve(root, '.env.local'), override: true });
  config({ path: resolve(root, 'supabase', '.env'), override: true });
}

export function ensureSupabaseDbPassword() {
  if (process.env.SUPABASE_DB_PASSWORD?.trim()) return true;

  const fromAlt = (
    process.env.POSTGRES_PASSWORD ||
    process.env.PGPASSWORD ||
    process.env.SUPABASE_POSTGRES_PASSWORD ||
    ''
  ).trim();
  if (fromAlt) {
    process.env.SUPABASE_DB_PASSWORD = fromAlt;
    return true;
  }

  const candidates = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.DIRECT_URL,
    process.env.SUPABASE_DATABASE_URL,
    process.env.SUPABASE_POOLER_URL,
  ].filter(Boolean);

  for (const raw of candidates) {
    try {
      const u = new URL(raw);
      if (u.password) {
        process.env.SUPABASE_DB_PASSWORD = decodeURIComponent(u.password);
        return true;
      }
    } catch {
      /* next */
    }
  }
  return false;
}

/** @returns {{ ok: boolean, status: number|null }} */
export function runSupabaseCliSync(root, cliArgs, { inheritStdio = true } = {}) {
  const spawnOpts = {
    cwd: root,
    stdio: inheritStdio ? 'inherit' : 'pipe',
    shell: true,
    env: process.env,
  };
  let r = spawnSync('supabase', cliArgs, spawnOpts);
  if (r.status === null || r.error) {
    console.error(
      '`supabase` not found or failed to spawn; retrying with npx supabase@latest …\n'
    );
    r = spawnSync('npx', ['--yes', 'supabase@latest', ...cliArgs], spawnOpts);
  }
  const status = typeof r.status === 'number' ? r.status : null;
  return { ok: status === 0, status };
}

export function exitWithCliCredentialsHelp() {
  console.error(
    'Missing DB credentials for CLI. Add ONE of:\n' +
      '  SUPABASE_DB_PASSWORD=...   # Dashboard → Project Settings → Database\n' +
      '  DATABASE_URL or SUPABASE_POOLER_URL with password embedded (see .env.local.example)\n'
  );
  process.exit(1);
}
