import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, serviceKey);

async function checkStats() {
    const { data: sites } = await supabase.from('sites').select('*');
    if (!sites) return;

    for (const site of sites) {
        const { count: sCount } = await supabase.from('sessions').select('id', { count: 'exact', head: true }).eq('site_id', site.id);
        const { count: gCount } = await supabase.from('sessions').select('id', { count: 'exact', head: true }).eq('site_id', site.id).not('gclid', 'is', null);
        const { count: cCount } = await supabase.from('calls').select('id', { count: 'exact', head: true }).eq('site_id', site.id).eq('source', 'click');

        console.log(`--- SITE: ${site.name} (${site.domain}) ---`);
        console.log(`  Public ID: ${site.public_id}`);
        console.log(`  Total Sessions: ${sCount || 0}`);
        console.log(`  Ads Sessions (GCLID): ${gCount || 0}`);
        console.log(`  Total Call Intents (click): ${cCount || 0}`);

        // Check if any intents have GCLID via session join
        if (cCount > 0) {
            const { data: adsIntents } = await supabase.rpc('get_recent_intents_v2', {
                p_site_id: site.id,
                p_date_from: '2026-01-01T00:00:00Z',
                p_date_to: '2026-02-01T00:00:00Z',
                p_limit: 10,
                p_ads_only: true
            });
            console.log(`  Recent Ads Intents (last month): ${adsIntents?.length || 0}`);
        }
        console.log('');
    }
}

checkStats();
