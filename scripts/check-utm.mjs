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

async function checkTraffic() {
    const { data: sites } = await supabase.from('sites').select('*');
    if (!sites) return;

    for (const site of sites) {
        const { data: sessions } = await supabase
            .from('sessions')
            .select('utm_term, utm_campaign, gclid')
            .eq('site_id', site.id)
            .not('gclid', 'is', null)
            .limit(5);

        console.log(`--- ${site.name} ---`);
        if (!sessions || sessions.length === 0) {
            console.log('  No GCLID sessions found.');
        } else {
            sessions.forEach(s => {
                console.log(`  Term: ${s.utm_term || '—'} | Campaign: ${s.utm_campaign || '—'} | GCLID: ${s.gclid.slice(0, 10)}...`);
            });
        }
    }
}

checkTraffic();
