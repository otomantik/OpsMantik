/**
 * POST /api/sales/confirm — confirm a sale and enqueue for offline conversion (atomic via RPC).
 * Body: { sale_id } only. Never accept site_id from client; scope is derived from the sale row.
 * Auth: fetch sale under RLS; if not found => 404. validateSiteAccess(sale.site_id) => 403 if denied.
 * Then call confirm_sale_and_enqueue(sale_id) RPC; map 409 (already confirmed/canceled), 500 (DB error).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { getEntitlements } from '@/lib/entitlements/getEntitlements';
import { requireCapability, EntitlementError } from '@/lib/entitlements/requireEntitlement';

export const runtime = 'nodejs';

const HEADERS = () => getBuildInfoHeaders();

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: HEADERS() });
  }

  let body: { sale_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: HEADERS() });
  }

  const saleId = body.sale_id;
  if (!saleId || typeof saleId !== 'string') {
    return NextResponse.json({ error: 'sale_id is required' }, { status: 400, headers: HEADERS() });
  }

  const { data: sale, error: fetchError } = await supabase
    .from('sales')
    .select('id, site_id, status, occurred_at, amount_cents, currency, conversation_id, created_at, updated_at')
    .eq('id', saleId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500, headers: HEADERS() });
  }
  if (!sale) {
    return NextResponse.json({ error: 'Sale not found' }, { status: 404, headers: HEADERS() });
  }

  const access = await validateSiteAccess(sale.site_id, user.id, supabase);
  if (!access.allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: HEADERS() });
  }

  const entitlements = await getEntitlements(sale.site_id, supabase);
  try {
    requireCapability(entitlements, 'google_ads_sync');
  } catch (err) {
    if (err instanceof EntitlementError) {
      return NextResponse.json({ error: 'Forbidden', code: 'CAPABILITY_REQUIRED', capability: err.capability }, { status: 403, headers: HEADERS() });
    }
    throw err;
  }

  const { data: rpcRows, error: rpcError } = await supabase
    .rpc('confirm_sale_and_enqueue', { p_sale_id: saleId });

  if (rpcError) {
    const msg = rpcError.message ?? '';
    if (msg.includes('sale_already_confirmed_or_canceled') || rpcError.code === 'P0001') {
      return NextResponse.json(
        { error: 'Sale already confirmed or canceled', code: 'ALREADY_CONFIRMED_OR_CANCELED' },
        { status: 409, headers: HEADERS() }
      );
    }
    if (msg.includes('sale_not_found')) {
      return NextResponse.json({ error: 'Sale not found' }, { status: 404, headers: HEADERS() });
    }
    return NextResponse.json({ error: rpcError.message ?? 'Database error' }, { status: 500, headers: HEADERS() });
  }

  const row = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
  const enqueued = row?.enqueued ?? false;
  const updatedSale = { ...sale, status: 'CONFIRMED' as const };

  return NextResponse.json(
    { success: true, sale: updatedSale, enqueued },
    { status: 200, headers: HEADERS() }
  );
}
