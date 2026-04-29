import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');
const FALLBACK_SCHEMA_PATHS = [
  join(process.cwd(), 'schema.sql'),
  join(process.cwd(), 'supabase', 'schema.sql'),
];

export function readMigrationByContractHints(hints: string[]): { path: string; source: string } {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  for (const file of files) {
    const path = join(MIGRATIONS_DIR, file);
    const source = readFileSync(path, 'utf8');
    const matched = hints.every((hint) => source.includes(hint));
    if (matched) return { path, source };
  }
  for (const path of FALLBACK_SCHEMA_PATHS) {
    try {
      const source = readFileSync(path, 'utf8');
      const matched = hints.every((hint) => source.includes(hint));
      if (matched) return { path, source };
    } catch {
      // ignore unavailable fallback snapshots
    }
  }
  throw new Error(`Migration contract not found for hints: ${hints.join(', ')}`);
}

export function readMigrationByContractHintsOptional(
  hints: string[]
): { path: string; source: string } | null {
  try {
    return readMigrationByContractHints(hints);
  } catch {
    return null;
  }
}

