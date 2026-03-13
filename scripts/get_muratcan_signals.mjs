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

async function checkMuratcanSignals() {
    const siteId = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073'; // Muratcan Akü

    // Get site name to be sure
    const { data: site } = await supabase.from('sites').select('name').eq('id', siteId).single();
    if (!site) {
        console.log("Site not found:", siteId);
        return;
    }

    console.log(`--- Kuyruktaki Sinyaller: ${site.name} ---`);

    // Get today's range (last 24-48 hours just in case)
    const now = new Date();
    const from = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
    const to = now.toISOString();

    const { data: intents, error } = await supabase.rpc('get_recent_intents_lite_v1', {
        p_site_id: siteId,
        p_date_from: from,
        p_date_to: to,
        p_limit: 50,
        p_ads_only: false
    });

    if (error) {
        console.error('RPC error:', error.message);
        return;
    }

    if (!intents || intents.length === 0) {
        console.log("Kuyrukta bekleyen sinyal bulunamadı.");
        return;
    }

    // Filter for pending intents
    const pendingIntents = intents.filter(it => {
        const s = (it.status || '').toLowerCase();
        return !s || s === 'intent';
    });

        pendingIntents.forEach((it, index) => {
            const time = new Date(it.created_at).toLocaleString('tr-TR');
            console.log(`SIG_${index+1}: ${time} | ID: ${it.id} | VER: ${it.version}`);
        });
}

checkMuratcanSignals();
