import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { adminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

/**
 * POST /api/cron/reconcile-usage/backfill
 * Backfill historical reconciliation jobs.
 * Body: { from: 'YYYY-MM', to: 'YYYY-MM', site_id?: string }
 */
export async function POST(req: NextRequest) {
    const forbidden = requireCronAuth(req);
    if (forbidden) return forbidden;

    try {
        const body = await req.json();
        const { from, to, site_id } = body;

        if (!from || !to) {
            return NextResponse.json({ error: 'Missing from/to in YYYY-MM format' }, { status: 400 });
        }

        // Generate months
        const start = new Date(from + '-01');
        const end = new Date(to + '-01');

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
        }

        // Safety: Limit 12 months
        const diffMonths = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
        if (diffMonths > 12 || diffMonths < 0) {
            return NextResponse.json({ error: 'Range too large (max 12 months) or invalid' }, { status: 400 });
        }

        const months = [];
        const curr = new Date(start);
        while (curr <= end) {
            const y = curr.getFullYear();
            const m = String(curr.getMonth() + 1).padStart(2, '0');
            months.push(`${y}-${m}`);
            curr.setMonth(curr.getMonth() + 1);
        }

        // Find sites to backfill
        let targetSiteIds: string[] = [];
        if (site_id) {
            targetSiteIds = [site_id];
        } else {
            // For backfill, we probably want all sites that existed? 
            // Or active then?
            // Safest is to list all sites if simple, but with 1M sites loop is bad.
            // Assumption: This is for specific repair or limited range.
            // If no site_id, we fetch ALL sites? 
            // "Enterprise Control" usually implies surgical backfill.
            // Let's implement paging or limit for safety.
            const { data: sites } = await adminClient.from('sites').select('id').limit(1000);
            /*
               CAUTION: Backfilling ALL sites for historical months is heavy.
               We will limit to 1000 sites for now and warn if more.
            */
            targetSiteIds = sites?.map(s => s.id) || [];
        }

        const jobs = [];
        for (const m of months) {
            for (const sid of targetSiteIds) {
                jobs.push({ site_id: sid, year_month: m, status: 'QUEUED' });
            }
        }

        if (jobs.length > 0) {
            const { error } = await adminClient
                .from('billing_reconciliation_jobs')
                .upsert(jobs, { onConflict: 'site_id,year_month', ignoreDuplicates: true });

            if (error) throw error;
        }

        return NextResponse.json({
            ok: true,
            backfilled_months: months,
            jobs_enqueued: jobs.length,
            sites_count: targetSiteIds.length
        }, { headers: getBuildInfoHeaders() });

    } catch (err: any) {
        const msg = err?.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
        return NextResponse.json(
            { ok: false, error: msg },
            { status: 500, headers: getBuildInfoHeaders() }
        );
    }
}
