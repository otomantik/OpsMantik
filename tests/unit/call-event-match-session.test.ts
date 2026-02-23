/**
 * Regression: cross-tenant session matching must never occur.
 * Same fingerprint on site A and site B must never match the other site's session.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { findRecentSessionByFingerprint } from '@/lib/api/call-event/match-session-by-fingerprint';

const SITE_A_ID = '00000000-0000-0000-0000-000000000001';
const SITE_B_ID = '00000000-0000-0000-0000-000000000002';
const SESSION_A_ID = '10000000-0000-0000-0000-000000000001';
const SESSION_B_ID = '20000000-0000-0000-0000-000000000002';
const FINGERPRINT = 'same-fp-across-sites';
const MONTH = '2026-02-01';
const THIRTY_MIN_AGO = new Date(Date.now() - 29 * 60 * 1000).toISOString();

function makeMockClient(siteIdToSession: Record<string, string>) {
  let lastSeenSiteId: string | null = null;
  let fromCallCount = 0;

  const thenable = (data: unknown) => ({
    then: (resolve: (v: unknown) => void) => resolve({ data, error: null }),
    catch: () => thenable(data),
  });

  const from = (table: string) => {
    fromCallCount += 1;
    const isFirstEvents = table === 'events' && fromCallCount === 1;
    const isSessions = table === 'sessions';
    const isThirdQuery = table === 'events' && fromCallCount === 3;

    return {
      select: () => ({
        eq: (col: string, value: string | number) => {
          if (col === 'site_id' && typeof value === 'string') lastSeenSiteId = value;
          if (isFirstEvents) {
            return {
              eq: () => ({
                in: () => ({
                  gte: () => ({
                    order: () => ({
                      order: () => ({
                        limit: async () => {
                          const sessionId = lastSeenSiteId ? siteIdToSession[lastSeenSiteId] : null;
                          return {
                            data:
                              sessionId ?
                                [{ session_id: sessionId, session_month: MONTH, metadata: {}, created_at: new Date().toISOString() }]
                              : [],
                            error: null,
                          };
                        },
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (isSessions) {
            return {
              eq: (col2: string, val2: string | number) => {
                if (col2 === 'site_id' && typeof val2 === 'string') lastSeenSiteId = val2;
                return {
                  eq: () => ({
                    single: async () => {
                      const sessionId = lastSeenSiteId ? siteIdToSession[lastSeenSiteId] : null;
                      if (sessionId) {
                        return { data: { id: sessionId, created_at: new Date().toISOString(), created_month: MONTH }, error: null };
                      }
                      return { data: null, error: { message: 'not found' } };
                    },
                  }),
                };
              },
            };
          }
          if (isThirdQuery) {
            return {
              eq: () => ({
                eq: () => thenable([{ event_category: 'interaction', event_action: 'view', metadata: { lead_score: 10 } }]),
              }),
            };
          }
          return { eq: () => ({ in: () => ({ gte: () => ({ order: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }) }) };
        },
      }),
    };
  };

  return { from } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

test('findRecentSessionByFingerprint: same fingerprint for site A never returns site B session', async () => {
  const mock = makeMockClient({
    [SITE_A_ID]: SESSION_A_ID,
    [SITE_B_ID]: SESSION_B_ID,
  });

  const resultA = await findRecentSessionByFingerprint(mock, {
    siteId: SITE_A_ID,
    fingerprint: FINGERPRINT,
    recentMonths: [MONTH],
    thirtyMinutesAgo: THIRTY_MIN_AGO,
  });

  assert.equal(resultA.matchedSessionId, SESSION_A_ID, 'Site A request must match session A');
  assert.notEqual(resultA.matchedSessionId, SESSION_B_ID, 'Site A request must NEVER match session B');
});

test('findRecentSessionByFingerprint: same fingerprint for site B never returns site A session', async () => {
  const mock = makeMockClient({
    [SITE_A_ID]: SESSION_A_ID,
    [SITE_B_ID]: SESSION_B_ID,
  });

  const resultB = await findRecentSessionByFingerprint(mock, {
    siteId: SITE_B_ID,
    fingerprint: FINGERPRINT,
    recentMonths: [MONTH],
    thirtyMinutesAgo: THIRTY_MIN_AGO,
  });

  assert.equal(resultB.matchedSessionId, SESSION_B_ID, 'Site B request must match session B');
  assert.notEqual(resultB.matchedSessionId, SESSION_A_ID, 'Site B request must NEVER match session A');
});

test('findRecentSessionByFingerprint: site with no events returns null session', async () => {
  const mock = makeMockClient({
    [SITE_A_ID]: SESSION_A_ID,
  });

  const resultB = await findRecentSessionByFingerprint(mock, {
    siteId: SITE_B_ID,
    fingerprint: FINGERPRINT,
    recentMonths: [MONTH],
    thirtyMinutesAgo: THIRTY_MIN_AGO,
  });

  assert.equal(resultB.matchedSessionId, null, 'Site B with no data must return null session');
});
