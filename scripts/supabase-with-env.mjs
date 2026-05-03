#!/usr/bin/env node
/**
 * Runs any Supabase CLI subcommand after loading repo env (same as db:push wrapper).
 *
 * Usage:
 *   node scripts/supabase-with-env.mjs migration repair --status reverted 2026...
 *   npm run db:supabase -- migration list
 */
import { loadSupabaseProjectEnv, ensureSupabaseDbPassword, runSupabaseCliSync, exitWithCliCredentialsHelp } from './supabase-cli-env.mjs';

const root = process.cwd();
loadSupabaseProjectEnv(root);
if (!ensureSupabaseDbPassword()) exitWithCliCredentialsHelp();

const cliArgs = process.argv.slice(2);
if (cliArgs.length === 0) {
  console.error('Usage: node scripts/supabase-with-env.mjs <supabase-args...>');
  process.exit(1);
}

const { ok, status } = runSupabaseCliSync(root, cliArgs);
process.exit(ok ? 0 : (status ?? 1));
