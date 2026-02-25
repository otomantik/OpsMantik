import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

const EXPECTED_SECRET = process.env.GOOGLE_SPEND_WEBHOOK_SECRET;

function getSecretFromRequest(req: NextRequest): string | null {
  const headerSecret = req.headers.get('x-opsmantik-webhook-secret');
  if (headerSecret?.trim()) return headerSecret.trim();
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  return null;
}

function validateSecret(provided: string | null): boolean {
  if (!EXPECTED_SECRET) return false;
  if (!provided) return false;
  return provided === EXPECTED_SECRET;
}

type PayloadItem = {
  campaignId: string;
  campaignName: string;
  cost: number;
  clicks?: number;
  impressions?: number;
  date: string;
};

type Body = {
  site_id: string;
  data: PayloadItem[];
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/webhooks/google-spend
 * Ingest daily Google Ads spend from Google Ads Script.
 * Auth: x-opsmantik-webhook-secret or Bearer token = GOOGLE_SPEND_WEBHOOK_SECRET.
 * Idempotent: upsert by (site_id, campaign_id, spend_date).
 */
export async function POST(req: NextRequest) {
  if (req.method !== 'POST') {
    return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
  }

  if (!validateSecret(getSecretFromRequest(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { site_id, data } = body;
  if (!site_id || typeof site_id !== 'string' || !UUID_REGEX.test(site_id)) {
    return NextResponse.json({ error: 'Invalid or missing site_id' }, { status: 400 });
  }
  if (!Array.isArray(data) || data.length === 0) {
    return NextResponse.json({ error: 'data must be a non-empty array' }, { status: 400 });
  }

  const rows: {
    site_id: string;
    campaign_id: string;
    campaign_name: string;
    cost_cents: number;
    clicks: number;
    impressions: number;
    spend_date: string;
    updated_at: string;
  }[] = [];

  for (const item of data as PayloadItem[]) {
    const campaignId = item?.campaignId != null ? String(item.campaignId) : null;
    const campaignName = item?.campaignName != null ? String(item.campaignName) : '';
    const cost = typeof item?.cost === 'number' ? item.cost : Number(item?.cost);
    const clicks = Math.max(0, Math.floor(Number(item?.clicks) || 0));
    const impressions = Math.max(0, Math.floor(Number(item?.impressions) || 0));
    const dateStr = item?.date != null ? String(item.date).trim() : '';

    if (!campaignId || !dateStr) continue;

    const cost_cents = Math.round(cost * 100);
    const spend_date = dateStr.slice(0, 10); // YYYY-MM-DD

    rows.push({
      site_id,
      campaign_id: campaignId,
      campaign_name: campaignName,
      cost_cents,
      clicks,
      impressions,
      spend_date,
      updated_at: new Date().toISOString(),
    });
  }

  if (rows.length === 0) {
    return NextResponse.json({ success: true, upserted: 0 });
  }

  const { error } = await adminClient
    .from('ad_spend_daily')
    .upsert(rows, { onConflict: 'site_id,campaign_id,spend_date' });

  if (error) {
    return NextResponse.json(
      { error: 'Upsert failed', message: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, upserted: rows.length });
}
