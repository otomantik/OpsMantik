import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { logError, logInfo } from '@/lib/logging/logger';
import { appendAuditLog } from '@/lib/audit/audit-log';

export const runtime = 'nodejs'; // Required for streaming CSV

/**
 * GET /api/billing/dispute-export?site_id=...&year_month=YYYY-MM
 * Financial Finality: Export raw ingest_idempotency ledger for dispute resolution.
 * Auth: Member of site_id (or platform admin).
 * Output: CSV stream.
 */
export async function GET(req: NextRequest) {
    const searchParams = req.nextUrl.searchParams;
    const siteId = searchParams.get('site_id');
    const yearMonth = searchParams.get('year_month');

    if (!siteId || !yearMonth) {
        return NextResponse.json(
            { error: 'Missing site_id or year_month' },
            { status: 400, headers: getBuildInfoHeaders() }
        );
    }

    // 1. Auth Check
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json(
            { error: 'Unauthorized' },
            { status: 401, headers: getBuildInfoHeaders() }
        );
    }

    // 2. Membership Check (RLS Bypass Safety)
    // ingest_idempotency has NO RLS for auth users, so we must verify membership explicitly
    // before using adminClient to fetch the data.
    const { data: membership, error: memberError } = await adminClient
        .from('site_members')
        .select('role')
        .eq('site_id', siteId)
        .eq('user_id', user.id)
        .maybeSingle();

    // Also allow platform admins (if public.is_admin exists/works, or check user metadata)
    // For now, strict site membership is safest.
    if (memberError || !membership) {
        // Fallback: check if they are the owner in `sites` table
        const { data: site, error: siteError } = await adminClient
            .from('sites')
            .select('id')
            .eq('id', siteId)
            .eq('user_id', user.id)
            .maybeSingle();

        if (siteError || !site) {
            return NextResponse.json(
                { error: 'Forbidden: You are not a member of this site.' },
                { status: 403, headers: getBuildInfoHeaders() }
            );
        }
    }

    // 3. Invoice Snapshot Check (Optional Header)
    // If exact invoice is frozen, return its hash in header for audit trail.
    const { data: snapshot } = await adminClient
        .from('invoice_snapshot')
        .select('snapshot_hash')
        .eq('site_id', siteId)
        .eq('year_month', yearMonth)
        .maybeSingle();

    const snapshotHash = snapshot?.snapshot_hash || '';

    // 4. Stream Data (CSV)
    // We use adminClient because ingest_idempotency is service_role only.
    // We strictly filter by site_id validated above.
    // Limit to prevent OOM on massive sites (e.g. 500k rows).
    const BATCH_SIZE = 1000;
    const { count } = await adminClient
        .from('ingest_idempotency')
        .select('*', { count: 'exact', head: true })
        .eq('site_id', siteId)
        .eq('year_month', yearMonth);

    if (count && count > 500000) {
        return NextResponse.json(
            { error: 'Export too large (>500k rows). Contact support for manual extraction.' },
            { status: 400, headers: getBuildInfoHeaders() }
        );
    }

    logInfo('DISPUTE_EXPORT_INIT', {
        site_id: siteId,
        user_id: user.id,
        year_month: yearMonth,
        snapshot_hash: snapshotHash
    });

    await appendAuditLog(adminClient, {
        actor_type: 'user',
        actor_id: user.id,
        action: 'dispute_export',
        resource_type: 'ingest_idempotency',
        resource_id: `${siteId}:${yearMonth}`,
        site_id: siteId,
        payload: { year_month: yearMonth },
    });

    // Create a TransformStream to format as CSV on the fly
    const encoder = new TextEncoder();
    const csvStream = new TransformStream({
        start(controller) {
            controller.enqueue(encoder.encode(
                'idempotency_key,created_at,billable,billing_state,year_month\n'
            ));
        },
        async transform(chunk, controller) {
            // Chunk is a row or array of rows? Supabase stream not directly supported in node client yet.
            // We'll use cursor pagination to stream manually if needed, but for MVP
            // let's fetch in one go (up to reasonable limit) or use a cursor loop.
            // For true streaming from Postgres via Supabase, we usually need direct connection.
            // Here we will use efficient pagination loops.
            // For the specific TransformStream interface, we need to feed it.
        }
    });

    // Since Next.js custom streaming with Supabase client is tricky, 
    // we will construct the response using an async generator.
    async function* makeIterator() {
        yield encoder.encode('idempotency_key,created_at,billable,billing_state,year_month\n');

        let lastKey = '';
        let hasMore = true;

        while (hasMore) {
            let query = adminClient
                .from('ingest_idempotency')
                .select('idempotency_key,created_at,billable,billing_state,year_month')
                .eq('site_id', siteId)
                .eq('year_month', yearMonth)
                .order('idempotency_key', { ascending: true })
                .limit(BATCH_SIZE);

            if (lastKey) {
                query = query.gt('idempotency_key', lastKey);
            }

            const { data, error } = await query;

            if (error) {
                logError('DISPUTE_EXPORT_FAIL', { error: error.message, site_id: siteId ?? undefined });
                yield encoder.encode(`ERROR: ${error.message}\n`);
                return;
            }

            if (!data || data.length === 0) {
                hasMore = false;
                break;
            }

            for (const row of data) {
                yield encoder.encode(
                    `"${row.idempotency_key}","${row.created_at}",${row.billable},${row.billing_state},${row.year_month}\n`
                );
            }

            lastKey = data[data.length - 1].idempotency_key;
            if (data.length < BATCH_SIZE) hasMore = false;
        }
    }

    const headers = new Headers(getBuildInfoHeaders());
    headers.set('Content-Type', 'text/csv');
    headers.set('Content-Disposition', `attachment; filename="dispute-${siteId}-${yearMonth}.csv"`);
    headers.set('Cache-Control', 'no-store');
    if (snapshotHash) {
        headers.set('x-opsmantik-snapshot-hash', snapshotHash);
    }

    return new NextResponse(makeIterator() as any, { headers });
}
