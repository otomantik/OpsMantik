/**
 * POST /api/calls/[id]/seal — Seal a call with sale amount (Casino Kasa).
 * Lookup: admin client (site_id only, no client input). Access: validateSiteAccess. Update: user client (RLS).
 * Accepts cookie session or Authorization: Bearer <access_token> (smoke tests).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { adminClient } from '@/lib/supabase/admin';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { logError, logWarn } from '@/lib/logging/logger';
import * as Sentry from '@sentry/nextjs';
import { hasCapability } from '@/lib/auth/rbac';
import { buildPhoneIdentity } from '@/lib/dic/phone-hash';
import { parseWithinTemporalSanityWindow } from '@/lib/utils/temporal-sanity';
import { resolveSealOccurredAt } from '@/lib/oci/occurred-at';
import { getChronologyFloorForCall } from '@/lib/oci/chronology-guard';
import { appendAuditLog } from '@/lib/audit/audit-log';
import { verifyProbeSignature } from '@/lib/probe/verify-signature';
import { sanitizeHelperFormPayload } from '@/lib/oci/optimization-contract';
import { normalizeCurrencyOrNeutral } from '@/lib/i18n/site-locale';
import { notifyOutboxPending } from '@/lib/oci/notify-outbox';
import { resolveMutationVersion } from '@/lib/integrity/mutation-version';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';

export const dynamic = 'force-dynamic';
const BACKDATE_APPROVAL_MS = 48 * 60 * 60 * 1000;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = req.headers.get('x-request-id') ?? undefined;
  const route = '/api/calls/[id]/seal';
  try {
    const { id: callId } = await params;
    if (!callId) {
      return NextResponse.json({ error: 'Missing call id' }, { status: 400 });
    }

    if (process.env.OCI_SEAL_PAUSED === 'true' || process.env.OCI_SEAL_PAUSED === '1') {
      logWarn('OCI_SEAL_PAUSED', { msg: 'Seal paused via OCI_SEAL_PAUSED env' });
      return NextResponse.json({ error: 'Seal paused', code: 'SEAL_PAUSED' }, { status: 503 });
    }

    const body = await req.json().catch(() => ({}));
    const deviceId = req.headers.get('x-ops-device-id')?.trim();
    const isProbe = Boolean(deviceId && typeof body.signature === 'string' && body.signature.trim());

    if (isProbe) {
      const { data: call } = await adminClient
        .from('calls')
        .select('id, site_id, version')
        .eq('id', callId)
        .maybeSingle();
      if (!call) {
        return NextResponse.json({ error: 'Call not found' }, { status: 404 });
      }
      const { data: device } = await adminClient
        .from('probe_devices')
        .select('id, public_key_pem')
        .eq('site_id', call.site_id)
        .eq('device_id', deviceId)
        .maybeSingle();
      if (!device?.public_key_pem) {
        return NextResponse.json({ error: 'Device not registered' }, { status: 401 });
      }

      const confirmedAtIso = new Date().toISOString();
      const occurredAtMeta = resolveSealOccurredAt({
        saleOccurredAt: body.timestamp != null && Number.isFinite(body.timestamp) ? new Date(body.timestamp).toISOString() : null,
        fallbackConfirmedAt: confirmedAtIso,
      });

      const probePayload = {
        callId,
        saleAmount: body.saleAmount,
        currency: body.currency ?? 'TRY',
        merchantNotes: body.merchantNotes,
        timestamp: body.timestamp,
      };
      const sigResult = verifyProbeSignature(
        device.public_key_pem as string,
        probePayload,
        (body.signature as string).trim()
      );
      if (!sigResult.ok) {
        logWarn('PROBE_SEAL_SIGNATURE_REJECTED', { route, call_id: callId, error: sigResult.error });
        return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
      }
      const saleAmountProbe = body.saleAmount != null ? Number(body.saleAmount) : null;
      const currencyProbe = normalizeCurrencyOrNeutral(typeof body.currency === 'string' ? body.currency : null);
      const merchantNotes = typeof body.merchantNotes === 'string' ? body.merchantNotes.trim().slice(0, 500) : '';
      if (saleAmountProbe != null && (Number.isNaN(saleAmountProbe) || saleAmountProbe < 0)) {
        return NextResponse.json({ error: 'saleAmount must be non-negative' }, { status: 400 });
      }
      // Phase 2: Authoritative SQL FSM (Probe Path)
      const { data: updatedCall, error: updateError } = await adminClient.rpc('apply_call_action_v2', {
        p_call_id: callId,
        p_site_id: call.site_id,
        p_stage: 'won',
        p_actor_id: deviceId,
        p_lead_score: 100,
        p_sale_metadata: {
          amount: saleAmountProbe,
          currency: currencyProbe,
          occurred_at: occurredAtMeta.occurredAt,
          notes: merchantNotes,
        },
        p_version: call.version,
        p_metadata: { route, request_id: requestId, source: 'probe_v2' },
      });

      if (updateError) {
        logWarn('PROBE_SEAL_V2_FAILED', { callId, error: updateError.message });
        return NextResponse.json({ error: updateError.message }, { status: 409 });
      }

      const callObj = updatedCall;
      void notifyOutboxPending({ callId, siteId: call.site_id, source: 'seal_probe_v2' });

      return NextResponse.json({
        success: true,
        approval_required: false,
        call: callObj,
      });
    }

    // ——— Bearer (dashboard) path ———
    // ... (parsing and validation remains same) ...
    const saleAmount = body.sale_amount != null ? Number(body.sale_amount) : null;
    const bodyCurrencyRaw = typeof body.currency === 'string' && body.currency.trim() ? body.currency : null;
    const saleOccurredAtRaw = typeof body.sale_occurred_at === 'string' ? body.sale_occurred_at.trim() : '';
    const entryReason = typeof body.entry_reason === 'string' ? body.entry_reason.trim().slice(0, 500) : '';
    const helperFormPayload = sanitizeHelperFormPayload(
      body.helper_form_payload && typeof body.helper_form_payload === 'object'
        ? body.helper_form_payload
        : null
    );
    const explicitSystemScore =
      body.system_score != null && Number.isFinite(Number(body.system_score))
        ? Number(body.system_score)
        : null;
    const leadScoreRaw = body.lead_score != null ? Number(body.lead_score) : null;
    const versionRaw = body.version != null ? Number(body.version) : null;
    const version =
      versionRaw !== null && versionRaw !== undefined && Number.isFinite(versionRaw)
        ? Math.round(versionRaw)
        : null;
    let leadScore =
      leadScoreRaw != null && Number.isFinite(leadScoreRaw) && leadScoreRaw >= 0 && leadScoreRaw <= 100
        ? Math.round(leadScoreRaw)
        : null;

    if (leadScore != null && leadScore > 0 && leadScore <= 5) {
      leadScore = leadScore * 20;
    }

    if (saleAmount != null && (Number.isNaN(saleAmount) || saleAmount < 0)) {
      return NextResponse.json({ error: 'sale_amount must be a non-negative number' }, { status: 400 });
    }
    if (saleOccurredAtRaw && !parseWithinTemporalSanityWindow(saleOccurredAtRaw)) {
      return NextResponse.json({ error: 'sale_occurred_at outside window' }, { status: 400 });
    }

    const authHeader = req.headers.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

    let userClient: SupabaseClient | undefined;
    let user: { id: string } | null = null;
    if (bearerToken) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      userClient = createClient(url!, anonKey!, {
        global: { headers: { Authorization: `Bearer ${bearerToken}` } },
      });
      const { data: sessionData } = await userClient.auth.setSession({ access_token: bearerToken, refresh_token: '' });
      user = sessionData?.user ?? (await userClient.auth.getUser(bearerToken)).data.user ?? null;
    }
    if (!user) {
      userClient = await createServerClient();
      const { data: { user: u } } = await userClient.auth.getUser();
      user = u ?? null;
    }
    if (!user || !userClient) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: call, error: fetchError } = await adminClient
      .from('calls')
      .select('id, site_id, version, created_at, optimization_stage')
      .eq('id', callId)
      .maybeSingle();

    if (fetchError || !call) return NextResponse.json({ error: 'Call not found' }, { status: 404 });

    const siteId = call.site_id;
    const access = await validateSiteAccess(siteId, user.id, userClient);
    if (!access.allowed || !access.role || !hasCapability(access.role, 'queue:operate')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 404 });
    }

    const rowVersion =
      typeof call.version === 'number' && Number.isFinite(call.version) ? Math.round(call.version) : null;
    const versionResolution = resolveMutationVersion({
      rawVersion: version,
      route,
      siteId,
      requestHeaders: req.headers,
      fallbackVersion: rowVersion,
      requestId,
    });
    if (!versionResolution.ok) {
      return NextResponse.json(
        { error: 'version must be an integer >= 1', code: 'INVALID_VERSION' },
        { status: 400 }
      );
    }

    let currency: string;
    if (bodyCurrencyRaw) {
      currency = normalizeCurrencyOrNeutral(bodyCurrencyRaw);
    } else {
      const { data: siteRow } = await adminClient.from('sites').select('currency').eq('id', siteId).maybeSingle();
      currency = normalizeCurrencyOrNeutral((siteRow as { currency?: string | null } | null)?.currency ?? null);
    }

    const confirmedAtIso = new Date().toISOString();
    const occurredAtMeta = resolveSealOccurredAt({
      saleOccurredAt: saleOccurredAtRaw || null,
      fallbackConfirmedAt: confirmedAtIso,
    });

    const chronologyFloor = saleOccurredAtRaw ? await getChronologyFloorForCall(siteId, callId) : null;
    if (chronologyFloor && new Date(occurredAtMeta.occurredAt).getTime() < new Date(chronologyFloor.observedAt).getTime()) {
      return NextResponse.json({ error: 'sale_occurred_at before click', code: 'SALE_OCCURRED_AT_BEFORE_CLICK_TIME' }, { status: 409 });
    }

    const backdatedMs = Math.max(0, new Date(confirmedAtIso).getTime() - new Date(occurredAtMeta.occurredAt).getTime());
    const approvalRequired = saleOccurredAtRaw.length > 0 && backdatedMs > BACKDATE_APPROVAL_MS;

    // Phone Identity (DIC)
    let phoneE164: string | null = null;
    let phoneHash: string | null = null;
    let phoneRaw: string | null = null;
    const callerPhoneInput = typeof body.caller_phone === 'string' ? body.caller_phone.trim() : '';
    if (callerPhoneInput) {
      const { data: siteRow } = await adminClient.from('sites').select('default_country_iso').eq('id', siteId).maybeSingle();
      const identity = buildPhoneIdentity({ rawPhone: callerPhoneInput, countryIso: siteRow?.default_country_iso ?? 'TR' });
      phoneRaw = identity.raw;
      phoneE164 = identity.e164;
      phoneHash = identity.hash;
    }

    // Phase 2: Authoritative SQL FSM (Dashboard Path)
    const { data: updatedCall, error: updateError } = await adminClient.rpc('apply_call_action_v2', {
      p_call_id: callId,
      p_site_id: siteId,
      p_stage: 'won',
      p_actor_id: user.id,
      p_lead_score: explicitSystemScore ?? leadScore ?? 100,
      p_sale_metadata: {
        amount: saleAmount,
        currency,
        occurred_at: occurredAtMeta.occurredAt,
        notes: entryReason,
        helper_form: helperFormPayload,
        backdated_ms: backdatedMs,
        approval_required: approvalRequired,
      },
      p_version: versionResolution.version,
      p_metadata: { route, request_id: requestId, source: 'seal_v2', mutation_origin: 'user' },
      p_caller_phone_raw: phoneRaw,
      p_caller_phone_e164: phoneE164,
      p_caller_phone_hash: phoneHash,
    });

    if (updateError) {
      const code = (updateError as { code?: string }).code;
      if (code === '40900') {
        incrementRefactorMetric('mutation_conflict_total');
        return NextResponse.json(
          {
            error: 'Concurrency conflict: the call state has changed. Please refresh.',
            code: 'CONCURRENCY_CONFLICT',
            latest_version_hint: rowVersion,
          },
          { status: 409 }
        );
      }
      logWarn('DASHBOARD_SEAL_V2_FAILED', { callId, error: updateError.message });
      return NextResponse.json({ error: updateError.message }, { status: 409 });
    }

    const callObj = updatedCall;
    void notifyOutboxPending({ callId, siteId, source: 'seal_v2' });

    if (approvalRequired) {
      await appendAuditLog(adminClient, {
        actor_type: 'user',
        actor_id: user.id,
        action: 'call_sale_time_pending_approval',
        resource_type: 'call',
        resource_id: callId,
        site_id: siteId,
        payload: { sale_occurred_at: occurredAtMeta.occurredAt, backdated_ms: backdatedMs },
      });
    }

    return NextResponse.json({
      success: true,
      approval_required: approvalRequired,
      call: callObj,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logError(message, { request_id: requestId, route });
    Sentry.captureException(err, { tags: { request_id: requestId, route } });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
