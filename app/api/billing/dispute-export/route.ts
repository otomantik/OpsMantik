/**
 * Revenue Kernel PR-7: Dispute export — CSV of ingest_idempotency rows for a site/month.
 * GET /api/billing/dispute-export?site_id=...&year_month=YYYY-MM
 * Auth: RBAC billing:view (owner, admin, or billing). Tenant-scoped: own site only.
 */

import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { hasCapability, type SiteRole } from '@/lib/auth/rbac';
import { logInfo } from '@/lib/logging/logger';

export const runtime = 'nodejs';

const YEAR_MONTH_REGEX = /^\d{4}-\d{2}$/;

function csvEscape(val: string | number | boolean | null): string {
  const s = val === null || val === undefined ? '' : String(val);
  if (/[,"\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const siteId = searchParams.get('site_id');
  const yearMonth = searchParams.get('year_month');

  if (!siteId || !yearMonth || !YEAR_MONTH_REGEX.test(yearMonth)) {
    return NextResponse.json(
      { error: 'Missing or invalid query: site_id and year_month (YYYY-MM) required' },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const access = await validateSiteAccess(siteId, user.id, supabase);
  if (!access.allowed) {
    return NextResponse.json({ error: 'Forbidden: no access to this site' }, { status: 403 });
  }

  const role = access.role as SiteRole | undefined;
  if (!role || !hasCapability(role, 'billing:view')) {
    return NextResponse.json({ error: 'Forbidden: billing view required' }, { status: 403 });
  }

  try {
    const { data: snapshotRow } = await adminClient
      .from('invoice_snapshot')
      .select('snapshot_hash')
      .eq('site_id', siteId)
      .eq('year_month', yearMonth)
      .maybeSingle();

    const snapshotHash = (snapshotRow as { snapshot_hash?: string } | null)?.snapshot_hash ?? null;

    const { data: rows, error } = await adminClient
      .from('ingest_idempotency')
      .select('created_at, idempotency_key, idempotency_version, billing_state, billable')
      .eq('site_id', siteId)
      .eq('year_month', yearMonth)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch export data', details: error.message },
        { status: 500 }
      );
    }

    const list = (rows ?? []) as {
      created_at: string;
      idempotency_key: string;
      idempotency_version: number;
      billing_state: string;
      billable: boolean;
    }[];

    const header = 'created_at,idempotency_key,idempotency_version,billing_state,billable';
    const bodyLines = list.map(
      (r) =>
        `${csvEscape(r.created_at)},${csvEscape(r.idempotency_key)},${csvEscape(r.idempotency_version)},${csvEscape(r.billing_state)},${csvEscape(r.billable)}`
    );
    const csv = [header, ...bodyLines].join('\n');
    const csvBytes = Buffer.from(csv, 'utf8');
    const exportHash = createHash('sha256').update(csvBytes).digest('hex');

    logInfo('BILLING_DISPUTE_EXPORT', {
      code: 'BILLING_DISPUTE_EXPORT',
      site_id: siteId,
      year_month: yearMonth,
      row_count: list.length,
      export_hash: exportHash,
    });

    const headers = new Headers({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="dispute-export-${siteId.slice(0, 8)}-${yearMonth}.csv"`,
      'x-opsmantik-export-hash': exportHash,
    });
    if (snapshotHash) {
      headers.set('x-opsmantik-snapshot-hash', snapshotHash);
    }

    return new NextResponse(csvBytes, { status: 200, headers });
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Export failed',
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
