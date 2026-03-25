import { normalizePhoneTarget } from '@/lib/api/call-event/shared';
import { logWarn } from '@/lib/logging/logger';
import { adminClient } from '@/lib/supabase/admin';
import type { PrimarySource } from '@/lib/conversation/primary-source';

type RpcClientLike = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

export interface ResolveIntentConversationInput {
  siteId: string;
  source: 'sync' | 'call_event' | 'probe';
  intentAction?: string | null;
  intentTarget?: string | null;
  explicitPhoneE164?: string | null;
  customerHash?: string | null;
  primaryCallId?: string | null;
  primarySessionId?: string | null;
  mizanValue?: number | null;
  pageUrl?: string | null;
  clickId?: string | null;
  formState?: string | null;
  primarySource?: PrimarySource | null;
  idempotencyKey?: string | null;
}

function compactObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== null && value !== undefined && value !== '')
  );
}

function isMissingResolveIntentRpcError(err: { code?: string; message?: string } | null): boolean {
  const code = (err?.code || '').toString();
  const message = (err?.message || '').toLowerCase();
  if (!message.includes('resolve_intent_and_upsert_conversation')) return false;
  return code.startsWith('PGRST') || message.includes('does not exist') || message.includes('not found');
}

export function extractConversationPhoneE164(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;

  const normalized = normalizePhoneTarget(value);
  if (!normalized) return null;

  const lowered = normalized.toLowerCase();
  let candidate = normalized;

  if (lowered.startsWith('tel:')) candidate = normalized.slice(4);
  else if (lowered.startsWith('wa:')) candidate = normalized.slice(3);
  else if (lowered.startsWith('whatsapp:')) candidate = normalized.slice('whatsapp:'.length);

  if (candidate.includes('/')) return null;

  const compact = candidate.replace(/[^\d+]/g, '');
  return compact.length >= 7 ? compact : null;
}

export function buildConversationSourceSummary(input: ResolveIntentConversationInput): Record<string, unknown> {
  return compactObject({
    source: input.source,
    intent_action: input.intentAction ?? null,
    intent_target: input.intentTarget ?? null,
    page_url: input.pageUrl ?? null,
    click_id: input.clickId ?? null,
    form_state: input.formState ?? null,
    gclid: input.primarySource?.gclid ?? null,
    wbraid: input.primarySource?.wbraid ?? null,
    gbraid: input.primarySource?.gbraid ?? null,
    utm_source: input.primarySource?.utm_source ?? null,
    utm_medium: input.primarySource?.utm_medium ?? null,
    utm_campaign: input.primarySource?.utm_campaign ?? null,
    utm_content: input.primarySource?.utm_content ?? null,
    utm_term: input.primarySource?.utm_term ?? null,
    referrer: input.primarySource?.referrer ?? null,
  });
}

export async function resolveIntentConversation(
  input: ResolveIntentConversationInput,
  deps: { client?: RpcClientLike } = {}
): Promise<string | null> {
  const client = deps.client ?? adminClient;
  const phoneE164 = extractConversationPhoneE164(input.explicitPhoneE164 ?? input.intentTarget ?? null);
  const sourceSummary = buildConversationSourceSummary(input);

  try {
    const { data, error } = await client.rpc('resolve_intent_and_upsert_conversation', {
      p_site_id: input.siteId,
      p_phone_e164: phoneE164,
      p_customer_hash: input.customerHash ?? null,
      p_primary_call_id: input.primaryCallId ?? null,
      p_primary_session_id: input.primarySessionId ?? null,
      p_mizan_value: Number.isFinite(input.mizanValue ?? null) ? input.mizanValue : 0,
      p_source_summary: sourceSummary,
      p_idempotency_key: input.idempotencyKey ?? null,
    });

    if (error) {
      logWarn('CONVERSATION_RESOLVE_INTENT_FAILED', {
        site_id: input.siteId,
        source: input.source,
        primary_call_id: input.primaryCallId ?? null,
        primary_session_id: input.primarySessionId ?? null,
        missing_rpc: isMissingResolveIntentRpcError(error),
        error: error.message,
      });
      return null;
    }

    if (typeof data === 'string') return data;
    if (Array.isArray(data) && typeof data[0] === 'string') return data[0];
    return null;
  } catch (error) {
    logWarn('CONVERSATION_RESOLVE_INTENT_THROWN', {
      site_id: input.siteId,
      source: input.source,
      primary_call_id: input.primaryCallId ?? null,
      primary_session_id: input.primarySessionId ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
