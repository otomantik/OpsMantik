import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import { NextRequest } from 'next/server';

// Load env before imports
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

function getEnv(key: string) {
    const val = process.env[key];
    if (!val) throw new Error(`Missing env: ${key}`);
    return val;
}

test('Reconciliation: Unified & Backfill', async (t) => {
    // Dynamic import to ensure env is loaded before modules that read it
    const { GET } = await import('../../app/api/cron/reconcile-usage/route');
    const { POST } = await import('../../app/api/cron/reconcile-usage/backfill/route');

    const SUPABASE_URL = getEnv('NEXT_PUBLIC_SUPABASE_URL');
    const SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
    });

    // 1. Authenticate
    process.env.CRON_SECRET = 'test_secret_12345';
    const cronSecret = 'test_secret_12345';

    // 2. Test Backfill (POST)
    // Queue for 2025-01 to 2025-02 for a fake site to verify DB insertion
    const fakeSiteId = crypto.randomUUID();
    const backfillReq = new NextRequest('http://localhost/api/cron/reconcile-usage/backfill', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cronSecret}` },
        body: JSON.stringify({ from: '2025-01', to: '2025-02', site_id: fakeSiteId })
    });

    const backfillRes = await POST(backfillReq);
    if (!backfillRes.ok) {
        // If 500, might be because site_id FK constraint?
        // Billing Reconciliation Jobs table structure?
        // If site_id is FK to sites, then random UUID will fail.
        // We might need to handle that or use existing site.
        // Let's assume FK exists. If so, we need to create a site first.
        console.warn('Backfill response:', backfillRes.status, await backfillRes.text());
    }

    // We expect it might fail if FK constraint exists.
    // If it fails with 500 FK violation, we should handle it or create site.
    // Let's create a site first.

    // Create temp site
    const suffix = crypto.randomBytes(4).toString('hex');
    // Need user... reusing the pattern from lifecycle test
    const { data: users } = await admin.auth.admin.listUsers();
    const userId = users?.users?.[0]?.id;

    let siteIdToUse = fakeSiteId;

    if (userId) {
        const { data: site } = await admin.from('sites').insert({
            user_id: userId,
            public_id: `rec_test_${suffix}`,
            domain: `rec-${suffix}.test`,
            name: 'Reconcile Test'
        }).select('id').single();
        if (site) {
            siteIdToUse = site.id;
            t.after(async () => {
                await admin.from('sites').delete().eq('id', siteIdToUse);
            });
        }
    }

    // Now call backfill with real site ID
    const backfillReq2 = new NextRequest('http://localhost/api/cron/reconcile-usage/backfill', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cronSecret}` },
        body: JSON.stringify({ from: '2025-01', to: '2025-02', site_id: siteIdToUse })
    });

    const backfillRes2 = await POST(backfillReq2);
    const backfillJson = await backfillRes2.json();
    assert.equal(backfillJson.ok, true, `Backfill failed: ${backfillJson.error}`);

    // VERIFY DB
    const { data: jobs } = await admin
        .from('billing_reconciliation_jobs')
        .select('*')
        .eq('site_id', siteIdToUse);

    assert.equal(jobs?.length, 2, 'Should have 2 jobs for backfill');
    const months = jobs?.map(j => j.year_month).sort();
    assert.deepEqual(months, ['2025-01', '2025-02']);

    // 3. Test Unified Enqueue (GET ?action=enqueue)
    const enqueueReq = new NextRequest('http://localhost/api/cron/reconcile-usage?action=enqueue', {
        headers: { 'Authorization': `Bearer ${cronSecret}` }
    });

    const enqueueRes = await GET(enqueueReq);
    if (!enqueueRes.ok) {
        throw new Error(`Enqueue failed: ${enqueueRes.status} ${await enqueueRes.text()}`);
    }
    const enqueueJson = await enqueueRes.json();
    assert.equal(enqueueJson.ok, true);
    assert.ok(enqueueJson.enqueue); // Check structure

    // 4. Test Unified Run (GET ?action=run)
    // This will try to process jobs. It might find 0 jobs or some.
    const runReq = new NextRequest('http://localhost/api/cron/reconcile-usage?action=run&limit=1', {
        headers: { 'Authorization': `Bearer ${cronSecret}` }
    });

    const runRes = await GET(runReq);
    if (!runRes.ok) {
        throw new Error(`Run failed: ${runRes.status} ${await runRes.text()}`);
    }
    const runJson = await runRes.json();
    assert.equal(runJson.ok, true);
    assert.ok(runJson.run);

    // Log success
    console.log('Reconciliation Verification Passed:', { backfill: backfillJson, enqueue: enqueueJson, run: runJson });
});
