/**
 * PR-OCI-7.1: Bridge ranking behavior - callTime proximity tie-break.
 * When multiple sessions have click IDs, prefer the one closest to callTime.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { findRecentSessionByFingerprint } from '@/lib/api/call-event/match-session-by-fingerprint';

const SITE_ID = '00000000-0000-0000-0000-000000000001';
const SESSION_OLDER = '10000000-0000-0000-0000-000000000001';
const SESSION_CLOSER = '20000000-0000-0000-0000-000000000002';
const FINGERPRINT = 'fp-bridge-ranking';
const MONTH = '2026-02-01';
const LOOKBACK = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

// callTime in the middle: older=10:00, callTime=10:05, closer=10:08
const T_OLDER = '2026-02-25T10:00:00.000Z';
const T_CLOSER = '2026-02-25T10:08:00.000Z';
const CALL_TIME = '2026-02-25T10:05:00.000Z';

function makeMockForCallTimeProximity(opts: {
  events: Array<{ session_id: string; session_month: string }>;
  sessions: Record<string, { id: string; created_at: string; gclid?: string | null }>;
}) {
  const { events, sessions } = opts;
  let fromCallCount = 0;
  let lastSessionId: string | null = null;

  const fromFn = (table: string) => {
    fromCallCount += 1;
    if (table === 'events' && fromCallCount === 1) {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              in: () => ({
                gte: () => ({
                  order: () => ({
                    order: () => ({
                      limit: async () => ({
                        data: events.map(e => ({ session_id: e.session_id, session_month: e.session_month, metadata: {}, created_at: new Date().toISOString() })),
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      };
    }
    if (table === 'sessions') {
      return {
        select: () => ({
          eq: (col: string, val: string | number) => {
            if (col === 'id' && typeof val === 'string') lastSessionId = val;
            return {
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => {
                    if (lastSessionId && sessions[lastSessionId]) {
                      const s = sessions[lastSessionId];
                      return { data: { ...s, created_month: MONTH, consent_scopes: [], wbraid: null, gbraid: null }, error: null };
                    }
                    return { data: null, error: null };
                  },
                }),
              }),
            };
          },
        }),
      };
    }
    if (table === 'events' && fromCallCount > 1) {
      const payload = { data: [{ event_category: 'interaction', metadata: { lead_score: 10 } }], error: null };
      const thenable = {
        then: (fn: (r: { data: unknown[]; error: null }) => void) => {
          fn(payload);
          return { catch: () => thenable };
        },
        catch: () => thenable,
      };
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => thenable,
            }),
          }),
        }),
      };
    }
    return { select: () => ({ eq: () => ({ in: () => ({ gte: () => ({ order: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }) }) }) };
  };

  return { from: fromFn } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

test('bridge ranking: clickId session closer to callTime wins', async () => {
  const mock = makeMockForCallTimeProximity({
    events: [
      { session_id: SESSION_OLDER, session_month: MONTH },
      { session_id: SESSION_CLOSER, session_month: MONTH },
    ],
    sessions: {
      [SESSION_OLDER]: { id: SESSION_OLDER, created_at: T_OLDER, gclid: 'gclid-older' },
      [SESSION_CLOSER]: { id: SESSION_CLOSER, created_at: T_CLOSER, gclid: 'gclid-closer' },
    },
  });

  const result = await findRecentSessionByFingerprint(mock, {
    siteId: SITE_ID,
    fingerprint: FINGERPRINT,
    recentMonths: [MONTH],
    lookbackCutoff: LOOKBACK,
    callTime: CALL_TIME,
  });

  // CallTime 10:05; older 10:00 (diff 5min), closer 10:08 (diff 3min) -> closer wins
  assert.equal(result.matchedSessionId, SESSION_CLOSER, 'Session closer to callTime must win');
});

test('bridge ranking: without callTime, most recent created_at wins', async () => {
  const mock = makeMockForCallTimeProximity({
    events: [
      { session_id: SESSION_OLDER, session_month: MONTH },
      { session_id: SESSION_CLOSER, session_month: MONTH },
    ],
    sessions: {
      [SESSION_OLDER]: { id: SESSION_OLDER, created_at: T_OLDER, gclid: 'gclid-older' },
      [SESSION_CLOSER]: { id: SESSION_CLOSER, created_at: T_CLOSER, gclid: 'gclid-closer' },
    },
  });

  const result = await findRecentSessionByFingerprint(mock, {
    siteId: SITE_ID,
    fingerprint: FINGERPRINT,
    recentMonths: [MONTH],
    lookbackCutoff: LOOKBACK,
    // no callTime
  });

  assert.equal(result.matchedSessionId, SESSION_CLOSER, 'Without callTime, most recent created_at wins');
});
