import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
}

export async function GET(req: NextRequest) {
  const expectedToken = process.env.WORKER_TENANT_MAP_TOKEN;
  const token =
    req.headers.get('x-ops-worker-token') ||
    req.nextUrl.searchParams.get('token');

  if (!expectedToken || token !== expectedToken) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data, error } = await adminClient
    .from('sites')
    .select('id, domain')
    .not('domain', 'is', null)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: 'Failed to load site domains' }, { status: 500 });
  }

  const map: Record<string, string> = {};
  for (const row of data || []) {
    const host = normalizeHost(String(row.domain ?? ''));
    if (!host || !row.id) continue;
    map[host] = row.id;
    map[`www.${host}`] = row.id;
  }

  return NextResponse.json({ map, generated_at: new Date().toISOString() });
}
