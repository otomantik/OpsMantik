/**
 * Sales API: POST create/upsert, GET list.
 * Auth: validateSiteAccess(site_id). No site_id accepted on confirm (use /api/sales/confirm).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { getBuildInfoHeaders } from '@/lib/build-info';

export const runtime = 'nodejs';

function parseAmount(body: { amount?: number; amount_cents?: number }): number | null {
  if (typeof body.amount_cents === 'number' && Number.isInteger(body.amount_cents) && body.amount_cents >= 0) {
    return body.amount_cents;
  }
  if (typeof body.amount === 'number' && !Number.isNaN(body.amount) && body.amount >= 0) {
    return Math.round(body.amount * 100);
  }
  return null;
}

async function validateConversationSite(
  supabase: Awaited<ReturnType<typeof createClient>>,
  siteId: string,
  conversationId: string | null
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  if (!conversationId) return { ok: true };

  const { data: conversation, error } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('site_id', siteId)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      response: NextResponse.json({ error: error.message }, { status: 500, headers: getBuildInfoHeaders() }),
    };
  }

  if (!conversation) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'conversation_id does not belong to this site', code: 'CONVERSATION_SITE_MISMATCH' },
        { status: 400, headers: getBuildInfoHeaders() }
      ),
    };
  }

  return { ok: true };
}

async function updateExistingDraftSale(
  supabase: Awaited<ReturnType<typeof createClient>>,
  saleId: string,
  siteId: string,
  payload: {
    amountCents: number;
    occurredAtIso: string;
    currency: string;
    customerHash: string | null;
    conversationId: string | null;
    notes: string | null;
  }
): Promise<{ data: unknown; error: { message: string; code?: string } | null }> {
  const { error } = await supabase
    .from('sales')
    .update({
      amount_cents: payload.amountCents,
      occurred_at: payload.occurredAtIso,
      currency: payload.currency,
      customer_hash: payload.customerHash ?? undefined,
      conversation_id: payload.conversationId ?? undefined,
      notes: payload.notes ?? undefined,
      updated_at: new Date().toISOString(),
    })
    .eq('id', saleId)
    .eq('site_id', siteId);

  if (error) {
    return { data: null, error: { message: error.message, code: error.code } };
  }

  const { data } = await supabase.from('sales').select('*').eq('id', saleId).eq('site_id', siteId).single();
  return { data, error: null };
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: getBuildInfoHeaders() });
  }

  let body: {
    site_id?: string;
    occurred_at?: string;
    amount?: number;
    amount_cents?: number;
    currency?: string;
    external_ref?: string;
    customer_hash?: string;
    conversation_id?: string;
    notes?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: getBuildInfoHeaders() });
  }

  const siteId = body.site_id;
  if (!siteId || typeof siteId !== 'string') {
    return NextResponse.json({ error: 'site_id is required' }, { status: 400, headers: getBuildInfoHeaders() });
  }

  const access = await validateSiteAccess(siteId, user.id, supabase);
  if (!access.allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: getBuildInfoHeaders() });
  }

  const occurredAt = body.occurred_at;
  if (!occurredAt || typeof occurredAt !== 'string') {
    return NextResponse.json({ error: 'occurred_at is required (ISO string)' }, { status: 400, headers: getBuildInfoHeaders() });
  }
  const occurredAtDate = new Date(occurredAt);
  if (Number.isNaN(occurredAtDate.getTime())) {
    return NextResponse.json({ error: 'occurred_at must be a valid ISO date string' }, { status: 400, headers: getBuildInfoHeaders() });
  }
  const { isWithinTemporalSanityWindow } = await import('@/lib/utils/temporal-sanity');
  if (!isWithinTemporalSanityWindow(occurredAtDate)) {
    return NextResponse.json(
      { error: 'occurred_at outside temporal sanity window [now - 90 days, now + 1 hour]' },
      { status: 400, headers: getBuildInfoHeaders() }
    );
  }

  const amountCents = parseAmount(body);
  if (amountCents === null) {
    return NextResponse.json({ error: 'amount (number) or amount_cents (integer) is required and must be >= 0' }, { status: 400, headers: getBuildInfoHeaders() });
  }

  const currency = (body.currency && typeof body.currency === 'string') ? body.currency : 'TRY';
  const externalRefRaw = body.external_ref != null ? String(body.external_ref) : null;
  const externalRef = externalRefRaw != null && externalRefRaw.trim() !== '' ? externalRefRaw.trim() : null;
  const customerHash = body.customer_hash != null ? String(body.customer_hash) : null;
  const conversationIdRaw = body.conversation_id != null ? String(body.conversation_id) : null;
  const conversationId = conversationIdRaw != null && conversationIdRaw.trim() !== '' ? conversationIdRaw.trim() : null;
  const notes = body.notes != null ? String(body.notes) : null;

  const conversationValidation = await validateConversationSite(supabase, siteId, conversationId);
  if (!conversationValidation.ok) {
    return conversationValidation.response;
  }

  if (externalRef) {
    const { data: existing, error: fetchError } = await supabase
      .from('sales')
      .select('id, site_id, occurred_at, amount_cents, currency, status, conversation_id, notes, created_at, updated_at')
      .eq('site_id', siteId)
      .eq('external_ref', externalRef)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500, headers: getBuildInfoHeaders() });
    }

    if (existing) {
      if (existing.status !== 'DRAFT') {
        return NextResponse.json(
          { error: 'Finalized sales cannot be mutated via external_ref replay', code: 'SALE_FINALIZED_IMMUTABLE' },
          { status: 409, headers: getBuildInfoHeaders() }
        );
      }

      const { data: updated, error: updateError } = await updateExistingDraftSale(supabase, existing.id, siteId, {
        amountCents,
        occurredAtIso: occurredAtDate.toISOString(),
        currency,
        customerHash,
        conversationId: conversationId ?? existing.conversation_id ?? null,
        notes: notes ?? existing.notes ?? null,
      });

      if (updateError) {
        if (updateError.message.includes('finalized identity fields are immutable')) {
          return NextResponse.json(
            { error: 'Finalized sales cannot be mutated via external_ref replay', code: 'SALE_FINALIZED_IMMUTABLE' },
            { status: 409, headers: getBuildInfoHeaders() }
          );
        }
        return NextResponse.json({ error: updateError.message }, { status: 500, headers: getBuildInfoHeaders() });
      }
      return NextResponse.json(updated, { status: 200, headers: getBuildInfoHeaders() });
    }
  }

  const { data: inserted, error: insertError } = await supabase
    .from('sales')
    .insert({
      site_id: siteId,
      occurred_at: occurredAtDate.toISOString(),
      amount_cents: amountCents,
      currency,
      status: 'DRAFT',
      external_ref: externalRef ?? undefined,
      customer_hash: customerHash ?? undefined,
      conversation_id: conversationId ?? undefined,
      notes: notes ?? undefined,
    })
    .select('id, site_id, occurred_at, amount_cents, currency, status, conversation_id, created_at, updated_at')
    .single();

  if (insertError) {
    if (insertError.code === '23505' && externalRef != null) {
      const { data: existing2, error: fetch2 } = await supabase
        .from('sales')
        .select('id, site_id, occurred_at, amount_cents, currency, status, conversation_id, notes, created_at, updated_at')
        .eq('site_id', siteId)
        .eq('external_ref', externalRef)
        .maybeSingle();
      if (!fetch2 && existing2) {
        if (existing2.status !== 'DRAFT') {
          return NextResponse.json(
            { error: 'Finalized sales cannot be mutated via external_ref replay', code: 'SALE_FINALIZED_IMMUTABLE' },
            { status: 409, headers: getBuildInfoHeaders() }
          );
        }
        const { data: updated, error: updateErr } = await updateExistingDraftSale(supabase, existing2.id, siteId, {
          amountCents,
          occurredAtIso: occurredAtDate.toISOString(),
          currency,
          customerHash,
          conversationId: conversationId ?? existing2.conversation_id ?? null,
          notes: notes ?? existing2.notes ?? null,
        });
        if (!updateErr) {
          return NextResponse.json(updated, { status: 200, headers: getBuildInfoHeaders() });
        }
        if (updateErr.message.includes('finalized identity fields are immutable')) {
          return NextResponse.json(
            { error: 'Finalized sales cannot be mutated via external_ref replay', code: 'SALE_FINALIZED_IMMUTABLE' },
            { status: 409, headers: getBuildInfoHeaders() }
          );
        }
      }
    }
    return NextResponse.json({ error: insertError.message }, { status: 500, headers: getBuildInfoHeaders() });
  }
  return NextResponse.json(inserted, { status: 200, headers: getBuildInfoHeaders() });
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: getBuildInfoHeaders() });
  }

  const searchParams = req.nextUrl.searchParams;
  const siteId = searchParams.get('site_id');
  if (!siteId) {
    return NextResponse.json({ error: 'site_id is required' }, { status: 400, headers: getBuildInfoHeaders() });
  }

  const access = await validateSiteAccess(siteId, user.id, supabase);
  if (!access.allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: getBuildInfoHeaders() });
  }

  let query = supabase
    .from('sales')
    .select('id, site_id, conversation_id, occurred_at, amount_cents, currency, status, external_ref, customer_hash, notes, created_at, updated_at')
    .eq('site_id', siteId)
    .order('occurred_at', { ascending: false });

  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (from) {
    const fromDate = new Date(from);
    if (!Number.isNaN(fromDate.getTime())) query = query.gte('occurred_at', fromDate.toISOString());
  }
  if (to) {
    const toDate = new Date(to);
    if (!Number.isNaN(toDate.getTime())) query = query.lte('occurred_at', toDate.toISOString());
  }
  const status = searchParams.get('status');
  if (status && ['DRAFT', 'CONFIRMED', 'CANCELED'].includes(status)) {
    query = query.eq('status', status);
  }

  const { data: rows, error } = await query;
  if (error) {
    const { logError } = await import('@/lib/logging/logger');
    logError('SALES_LIST_FAILED', { code: (error as { code?: string })?.code });
    return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500, headers: getBuildInfoHeaders() });
  }
  return NextResponse.json(rows ?? [], { status: 200, headers: getBuildInfoHeaders() });
}
