import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatSupabaseClientError } from '../../lib/oci/format-supabase-error';

test('formatSupabaseClientError never returns [object Object] for PostgREST-shaped errors', () => {
  const msg = formatSupabaseClientError({
    message: 'Could not find the function public.get_command_center_p0_stats_v2',
    code: 'PGRST202',
    details: 'Searched for the function public.get_command_center_p0_stats_v2',
  });
  assert.ok(!msg.includes('[object Object]'));
  assert.ok(msg.includes('get_command_center_p0_stats_v2'));
});

test('useCommandCenterP0Stats uses formatSupabaseClientError for SWR errors', () => {
  const src = readFileSync(join(process.cwd(), 'lib/hooks/use-command-center-p0-stats.ts'), 'utf8');
  assert.ok(src.includes('formatSupabaseClientError'));
  assert.ok(!src.includes('String(error)'));
});
