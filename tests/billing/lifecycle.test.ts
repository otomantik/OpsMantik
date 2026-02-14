import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/cron/idempotency-cleanup/route';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

function getEnv(key: string) {
    const val = process.env[key];
    if (!val) throw new Error(`Missing env: ${key}`);
    return val;
}

test('Lifecycle: 90-Day Retention (Direct Handler)', async (t) => {
    const SUPABASE_URL = getEnv('NEXT_PUBLIC_SUPABASE_URL');
    const SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
    });

    // 1. Authenticate or Mock
    // Hardcode env var to ensure handler sees it
    process.env.CRON_SECRET = 'test_secret_12345';
    const cronSecret = 'test_secret_12345';

    // 2. Setup Site
    const { data: users } = await admin.auth.admin.listUsers();
    if (!users.users || users.users.length === 0) {
        console.warn('Skipping Lifecycle test: No users found.');
        return;
    }
    const userId = users.users[0].id;

    const suffix = crypto.randomBytes(4).toString('hex');
    const { data: site, error: siteErr } = await admin.from('sites').insert({
        user_id: userId,
        public_id: `cycle_test_${suffix}`,
        domain: `cycle-${suffix}.test`,
        name: 'Lifecycle Test'
    }).select('id').single();

    if (siteErr) throw siteErr;
    const siteId = site.id;

    t.after(async () => {
        await admin.from('sites').delete().eq('id', siteId);
    });

    // 3. Insert Data
    const now = new Date();
    const day91 = new Date(now.getTime() - 91 * 24 * 60 * 60 * 1000).toISOString();
    const day89 = new Date(now.getTime() - 89 * 24 * 60 * 60 * 1000).toISOString();
    const expOld = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString();
    const expNew = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000).toISOString();

    const nowIso = now.toISOString();
    const expCurrent = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString();
    await admin.from('ingest_idempotency').insert([
        { site_id: siteId, idempotency_key: 'old_key', created_at: day91, expires_at: expOld },
        { site_id: siteId, idempotency_key: 'new_key', created_at: day89, expires_at: expNew },
        { site_id: siteId, idempotency_key: 'current_key', created_at: nowIso, expires_at: expCurrent }
    ]);

    // 4. Invoke Handler Directly
    const req = new NextRequest('http://localhost/api/cron/idempotency-cleanup', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${cronSecret}`
        }
    });

    const res = await POST(req);

    if (!res.ok) {
        const text = await res.text();
        console.error('Handler failed:', res.status, text);
        assert.fail(`Handler returned ${res.status}: ${text}`);
    }

    const json = await res.json();
    assert.equal(json.ok, true);

    // 5. Verify DB State
    const { data: rows } = await admin.from('ingest_idempotency').select('idempotency_key').eq('site_id', siteId);
    const keys = rows?.map(r => r.idempotency_key) || [];

    assert.ok(!keys.includes('old_key'), `Old key should be deleted. Keys present: ${keys.join(', ')}`);
    assert.ok(keys.includes('new_key'), `New key should remain. Keys present: ${keys.join(', ')}`);
    assert.ok(keys.includes('current_key'), `Current-month row must not be deleted. Keys present: ${keys.join(', ')}`);
});
