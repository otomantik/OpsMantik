import { adminClient } from '../lib/supabase/admin';
import dotenv from 'dotenv';
import path from 'path';

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

type SignalRow = {
    id: string;
    site_id: string;
    signal_type: string | null;
    dispatch_status: string | null;
    conversion_value: number | null;
    google_conversion_time: string | null;
    created_at: string;
    gclid: string | null;
    google_conversion_name: string | null;
};

type SiteRow = { id: string; name: string | null };
type TrSignalRow = { id: string; site_id: string; causal_dna: unknown };

function asObject(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

function readGeoToken(causalDna: unknown): string {
    const dna = asObject(causalDna);
    if (!dna) return '';
    const metaDirect = asObject(dna.meta);
    const dnaNested = asObject(dna.dna);
    const metaNested = asObject(dnaNested?.meta);
    const meta = metaDirect ?? metaNested;
    const location = asObject(meta?.location);
    const geo = location?.city ?? location?.country ?? location?.city_name;
    return String(geo ?? '').toLowerCase();
}

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
        const signalRows = (signals ?? []) as SignalRow[];
        const statuses = signalRows.reduce<Record<string, number>>((acc, s) => {
            const status = s.dispatch_status ?? 'UNKNOWN';
            acc[status] = (acc[status] || 0) + 1;
            return acc;
        }, {});
        console.log('Signal Statuses (7 days):', statuses);

        const zombies = signalRows.filter(s =>
            s.dispatch_status === 'PROCESSING' &&
            new Date(s.created_at).getTime() < Date.now() - 60 * 60 * 1000
        );
        console.log(`🧟 Zombie Signals (>1h processing): ${zombies.length}`);

        // User specifically asked for 'pending', 'failed', 'processing'
        const pendingCount = signalRows.filter(s => s.dispatch_status === 'PENDING').length;
        const failedCount = signalRows.filter(s => s.dispatch_status === 'FAILED').length;
        const processingCount = signalRows.filter(s => s.dispatch_status === 'PROCESSING').length;
        console.log(`📊 Focus Statuses -> PENDING: ${pendingCount}, FAILED: ${failedCount}, PROCESSING: ${processingCount}`);

        // Duplicate Check
        const overlaps = signalRows.filter((s, i) => {
            return signalRows.some((other, j) => {
                if (i === j) return false;
                if (s.gclid && s.gclid === other.gclid && s.google_conversion_name === other.google_conversion_name && s.google_conversion_time && other.google_conversion_time) {
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
    const siteRows = (sites ?? []) as SiteRow[];
    const siteMap = new Map(siteRows.map(s => [s.id, s]));

    const poison = ((signals ?? []) as SignalRow[]).filter(s => {
        const val = s.conversion_value ?? 0;
        const site = siteMap.get(s.site_id);
        const threshold = 120; // canonical satis max at score 100 => 120
        void site;
        return val === 0 || val > threshold;
    });

    console.log(`🧪 Poisoned Signals (0 or > canonical max ${120}): ${poison?.length || 0}`);

    // 3. Geolocation & SST Failure Audit
    console.log('\n--- 3. Geolocation & SST Failure Audit ---');
    // Turkish Sites: Muratcan Akü, Yapı Özmen
    const trSiteIds = siteRows.filter(s => {
        const name = s.name || '';
        return name.includes('Muratcan') || name.includes('Yap');
    }).map(s => s.id);

    const { data: trSignals } = await adminClient
        .from('marketing_signals')
        .select('id, site_id, causal_dna')
        .in('site_id', trSiteIds)
        .gte('created_at', SEVEN_DAYS_AGO);

    const geoFailures = ((trSignals ?? []) as TrSignalRow[]).filter(s => {
        const geoStr = readGeoToken(s.causal_dna);
        return geoStr.includes('dusseldorf') || geoStr.includes('germany') || !geoStr || geoStr === 'unknown';
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
