import { adminClient } from '../lib/supabase/admin';
import dotenv from 'dotenv';
import path from 'path';

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function runForensics() {
    console.log('🕵️  Starting OCI Forensics Protocol...');

    const SEVEN_DAYS_AGO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    console.log(`📅 Analysis window: > ${SEVEN_DAYS_AGO}\n`);

    // 1. Queue & Orphan Signal Exposure
    console.log('--- 1. Queue & Orphan Signal Exposure ---');
    const { data: signals, error: sigError } = await adminClient
        .from('marketing_signals')
        .select('id, site_id, signal_type, dispatch_status, conversion_value, google_conversion_time, created_at, gclid, google_conversion_name')
        .gte('created_at', SEVEN_DAYS_AGO);

    if (sigError) {
        console.error('❌ Error fetching signals:', sigError.message);
    } else {
        const statuses = signals.reduce((acc: any, s) => {
            acc[s.dispatch_status] = (acc[s.dispatch_status] || 0) + 1;
            return acc;
        }, {});
        console.log('Signal Statuses (7 days):', statuses);

        const zombies = signals.filter(s =>
            s.dispatch_status === 'PROCESSING' &&
            new Date(s.created_at).getTime() < Date.now() - 60 * 60 * 1000
        );
        console.log(`🧟 Zombie Signals (>1h processing): ${zombies.length}`);

        // User specifically asked for 'pending', 'failed', 'processing'
        const pendingCount = signals.filter(s => s.dispatch_status === 'PENDING').length;
        const failedCount = signals.filter(s => s.dispatch_status === 'FAILED').length;
        const processingCount = signals.filter(s => s.dispatch_status === 'PROCESSING').length;
        console.log(`📊 Focus Statuses -> PENDING: ${pendingCount}, FAILED: ${failedCount}, PROCESSING: ${processingCount}`);

        // Duplicate Check
        const overlaps = signals.filter((s, i) => {
            return signals.some((other, j) => {
                if (i === j) return false;
                if (s.gclid && s.gclid === other.gclid && s.google_conversion_name === other.google_conversion_name) {
                    const t1 = new Date(s.google_conversion_time).getTime();
                    const t2 = new Date(other.google_conversion_time).getTime();
                    return Math.abs(t1 - t2) < 5 * 60 * 1000;
                }
                return false;
            });
        });
        console.log(`👯 Potential overlaps (5m window): ${overlaps.length / 2} pairs`);
    }

    // 2. Mathematical "Poison" Detection
    console.log('\n--- 2. Mathematical "Poison" Detection ---');
    const { data: sites } = await adminClient.from('sites').select('id, name');
    const siteMap = new Map(sites?.map(s => [s.id, s]));

    const poison = signals?.filter(s => {
        const val = s.conversion_value ?? 0;
        const site = siteMap.get(s.site_id);
        const threshold = 120; // canonical satis max at score 100 => 120
        return val === 0 || val > threshold;
    });

    console.log(`🧪 Poisoned Signals (0 or > canonical max ${120}): ${poison?.length || 0}`);

    // 3. Geolocation & SST Failure Audit
    console.log('\n--- 3. Geolocation & SST Failure Audit ---');
    // Turkish Sites: Muratcan Akü, Yapı Özmen
    const trSiteIds = sites?.filter(s => {
        const name = s.name || '';
        return name.includes('Muratcan') || name.includes('Yap');
    })?.map(s => s.id) || [];

    const { data: trSignals } = await adminClient
        .from('marketing_signals')
        .select('id, site_id, causal_dna')
        .in('site_id', trSiteIds)
        .gte('created_at', SEVEN_DAYS_AGO);

    const geoFailures = trSignals?.filter(s => {
        const dna = s.causal_dna as any;
        const meta = dna?.meta || dna?.dna?.meta;
        const geo = meta?.location?.city || meta?.location?.country || meta?.location?.city_name;
        const geoStr = String(geo || '').toLowerCase();
        return geoStr.includes('dusseldorf') || geoStr.includes('germany') || !geo || geoStr === 'unknown';
    });

    console.log(`🌍 Geo-Location Failures (TR sites showing EU/Unknown): ${geoFailures?.length || 0}`);

    // 4. Cron & Background Job Autopsy
    console.log('\n--- 4. Cron & Background Job Autopsy ---');
    const { data: lastSyncs } = await adminClient
        .from('marketing_signals')
        .select('google_conversion_time, dispatch_status')
        .in('dispatch_status', ['SYNCED', 'SENT'])
        .order('google_conversion_time', { ascending: false })
        .limit(10);

    console.log('Last 10 Sync Timestamps:', lastSyncs?.map(s => `${s.google_conversion_time} (${s.dispatch_status})`));

    // Check queue
    const { data: queueItems } = await adminClient
        .from('offline_conversion_queue')
        .select('id, status, created_at, error_message')
        .order('created_at', { ascending: false })
        .limit(10);
    console.log('Recent Queue Items (offline_conversion_queue):', queueItems?.length || 0);
    if (queueItems && queueItems.length > 0) {
        queueItems.forEach(q => console.log(` - ${q.id}: ${q.status} (Created: ${q.created_at}) Error: ${q.error_message || 'None'}`));
    }

    // 5. Tenant Configuration Mismatch
    console.log('\n--- 5. Tenant Configuration Mismatch ---');
    const { data: nullSites } = await adminClient
        .from('marketing_signals')
        .select('id')
        .is('site_id', null);
    console.log(`🚫 Signals with NULL site_id: ${nullSites?.length || 0}`);

    console.log('\n✅ Forensics Complete.');
}

runForensics();
