import { adminClient } from '@/lib/supabase/admin';
import { getDbNowIso } from '@/lib/time/db-now';

const PHONE_STITCH_WINDOW_DAYS = 30;
const FINGERPRINT_STITCH_WINDOW_DAYS = 14;

type ChronologySource = 'matched_session' | 'conversation_session' | 'phone_stitch' | 'fingerprint_stitch';

type ChronologyCandidate = {
  observedAt: string;
  source: ChronologySource;
};

function hasClickId(row: { gclid?: string | null; wbraid?: string | null; gbraid?: string | null }) {
  return Boolean((row.gclid ?? '').trim() || (row.wbraid ?? '').trim() || (row.gbraid ?? '').trim());
}

function pickEarliestCandidate(candidates: ChronologyCandidate[]) {
  if (candidates.length === 0) return null;
  return candidates.reduce((earliest, current) =>
    new Date(current.observedAt).getTime() < new Date(earliest.observedAt).getTime() ? current : earliest
  );
}

export async function getChronologyFloorForCall(siteId: string, callId: string) {
  const { data: call } = await adminClient
    .from('calls')
    .select('id, matched_session_id, caller_phone_e164, matched_fingerprint')
    .eq('site_id', siteId)
    .eq('id', callId)
    .maybeSingle();

  if (!call) return null;

  const candidates: ChronologyCandidate[] = [];

  const matchedSessionId = (call as { matched_session_id?: string | null }).matched_session_id ?? null;
  if (matchedSessionId) {
    const { data: session } = await adminClient
      .from('sessions')
      .select('created_at, gclid, wbraid, gbraid')
      .eq('site_id', siteId)
      .eq('id', matchedSessionId)
      .maybeSingle();
    if (session && hasClickId(session)) {
      candidates.push({
        observedAt: (session as { created_at: string }).created_at,
        source: 'matched_session',
      });
    }
  }

  const callerPhoneE164 = (call as { caller_phone_e164?: string | null }).caller_phone_e164 ?? null;
  if (callerPhoneE164) {
    const dbNowIso = await getDbNowIso();
    const since = new Date(new Date(dbNowIso).getTime() - PHONE_STITCH_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: relatedCalls } = await adminClient
      .from('calls')
      .select('id, matched_session_id')
      .eq('site_id', siteId)
      .eq('caller_phone_e164', callerPhoneE164)
      .neq('id', callId)
      .in('status', ['confirmed', 'qualified', 'real'])
      .gte('created_at', since)
      .limit(20);
    const sessionIds = [...new Set((relatedCalls ?? []).map((row) => row.matched_session_id).filter(Boolean))];
    if (sessionIds.length > 0) {
      const { data: sessions } = await adminClient
        .from('sessions')
        .select('created_at, gclid, wbraid, gbraid')
        .eq('site_id', siteId)
        .in('id', sessionIds as string[]);
      for (const session of sessions ?? []) {
        if (hasClickId(session)) {
          candidates.push({
            observedAt: (session as { created_at: string }).created_at,
            source: 'phone_stitch',
          });
        }
      }
    }
  }

  const fingerprint = (call as { matched_fingerprint?: string | null }).matched_fingerprint ?? null;
  if (fingerprint) {
    const dbNowIso = await getDbNowIso();
    const since = new Date(new Date(dbNowIso).getTime() - FINGERPRINT_STITCH_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: sessions } = await adminClient
      .from('sessions')
      .select('created_at, gclid, wbraid, gbraid')
      .eq('site_id', siteId)
      .eq('fingerprint', fingerprint)
      .gte('created_at', since)
      .limit(20);
    for (const session of sessions ?? []) {
      if (hasClickId(session)) {
        candidates.push({
          observedAt: (session as { created_at: string }).created_at,
          source: 'fingerprint_stitch',
        });
      }
    }
  }

  return pickEarliestCandidate(candidates);
}

export async function getChronologyFloorForConversation(siteId: string, conversationId: string) {
  const { data: conversation } = await adminClient
    .from('conversations')
    .select('id, primary_session_id')
    .eq('site_id', siteId)
    .eq('id', conversationId)
    .maybeSingle();

  const primarySessionId = (conversation as { primary_session_id?: string | null } | null)?.primary_session_id ?? null;
  if (!primarySessionId) return null;

  const { data: session } = await adminClient
    .from('sessions')
    .select('created_at, gclid, wbraid, gbraid')
    .eq('site_id', siteId)
    .eq('id', primarySessionId)
    .maybeSingle();

  if (!session || !hasClickId(session)) return null;
  return {
    observedAt: (session as { created_at: string }).created_at,
    source: 'conversation_session' as const,
  };
}
