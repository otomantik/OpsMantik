import '../mock-env';
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPhaseContext } from '@/lib/refactor/phase-context';
import { REFACTOR_PHASE_TAG } from '@/lib/version';

test('buildPhaseContext includes phase_tag and flag snapshot', () => {
  const c = buildPhaseContext({ route_name: '/api/sync', site_id: '00000000-0000-0000-0000-000000000099' });
  assert.equal(c.phase_tag, REFACTOR_PHASE_TAG);
  assert.equal(c.route_name, '/api/sync');
  assert.equal(c.site_id, '00000000-0000-0000-0000-000000000099');
  assert.ok(typeof c.truth_flags_snapshot.truth_shadow_write_enabled === 'boolean');
});
