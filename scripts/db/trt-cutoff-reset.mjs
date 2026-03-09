import { createClient } from '@supabase/supabase-js';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: '.env.local' });

const TIMEZONE = 'Europe/Istanbul';

function getEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function getZonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function zonedTimeToUtc(parts, timeZone) {
  const guess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
  const observed = getZonedParts(guess, timeZone);
  const observedUtcMs = Date.UTC(
    observed.year,
    observed.month - 1,
    observed.day,
    observed.hour,
    observed.minute,
    observed.second
  );
  const diffMs = observedUtcMs - guess.getTime();
  return new Date(guess.getTime() - diffMs);
}

function computeDefaultCutoff() {
  const now = new Date();
  const todayTrt = getZonedParts(now, TIMEZONE);
  const todayStartUtc = zonedTimeToUtc(
    {
      year: todayTrt.year,
      month: todayTrt.month,
      day: todayTrt.day,
      hour: 0,
      minute: 0,
      second: 0,
    },
    TIMEZONE
  );
  return new Date(todayStartUtc.getTime() - 24 * 60 * 60 * 1000);
}

function parseArgs(argv) {
  const args = {
    execute: false,
    force: false,
    cutoff: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--execute') args.execute = true;
    else if (arg === '--dry-run') args.execute = false;
    else if (arg === '--force') args.force = true;
    else if (arg === '--cutoff') {
      args.cutoff = argv[i + 1] ?? null;
      i += 1;
    }
  }

  return args;
}

function printSummary(rows, cutoffIso, dryRun) {
  console.log(`TRT cutoff reset | mode=${dryRun ? 'dry-run' : 'execute'} | timezone=${TIMEZONE}`);
  console.log(`cutoff_utc=${cutoffIso}`);
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log('No affected rows.');
    return;
  }
  const normalized = rows.map((row) => ({
    step: row.step,
    affected: Number(row.affected ?? 0),
  }));
  console.table(normalized);
  const total = normalized.reduce((sum, row) => sum + row.affected, 0);
  console.log(`total_affected=${total}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = !args.execute;
  if (!dryRun && !args.force) {
    throw new Error('Refusing destructive reset without --force');
  }

  const cutoff = args.cutoff ? new Date(args.cutoff) : computeDefaultCutoff();
  if (Number.isNaN(cutoff.getTime())) {
    throw new Error(`Invalid cutoff: ${args.cutoff}`);
  }

  const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const cutoffIso = cutoff.toISOString();
  const { data, error } = await supabase.rpc('reset_business_data_before_cutoff_v1', {
    p_cutoff: cutoffIso,
    p_dry_run: dryRun,
  });

  if (error) {
    throw new Error(`reset_business_data_before_cutoff_v1 failed: ${error.message}`);
  }

  printSummary(Array.isArray(data) ? data : [], cutoffIso, dryRun);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
