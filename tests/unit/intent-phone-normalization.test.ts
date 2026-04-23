import test from 'node:test';
import assert from 'node:assert/strict';
import { IntentService } from '@/lib/services/intent-service';

test('normalizes local TR mobile numbers from tel links', () => {
  const normalize = (IntentService as unknown as { canonicalizePhoneDigits: (v: string) => string | null }).canonicalizePhoneDigits;
  assert.equal(normalize('05321234567'), '+905321234567');
  assert.equal(normalize('5321234567'), '+905321234567');
});

test('keeps explicit international numbers and rejects too-short values', () => {
  const normalize = (IntentService as unknown as { canonicalizePhoneDigits: (v: string) => string | null }).canonicalizePhoneDigits;
  assert.equal(normalize('+447700900123'), '+447700900123');
  assert.equal(normalize('12345'), null);
});
