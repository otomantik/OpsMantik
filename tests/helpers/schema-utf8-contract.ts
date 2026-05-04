import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let cached: string | null = null;

/** Full `schema_utf8.sql` snapshot (lazy); used when incremental migrations are not in repo. */
export function getSchemaUtf8(): string {
  if (!cached) {
    cached = readFileSync(join(process.cwd(), 'schema_utf8.sql'), 'utf8');
  }
  return cached;
}

export function schemaUtf8Slice(startMarker: string, endMarker: string): string {
  const full = getSchemaUtf8();
  const s = full.indexOf(startMarker);
  const e = full.indexOf(endMarker, s + 1);
  if (s === -1 || e === -1) {
    throw new Error(`schema_utf8 slice not found (start=${startMarker.slice(0, 80)})`);
  }
  return full.slice(s, e);
}
