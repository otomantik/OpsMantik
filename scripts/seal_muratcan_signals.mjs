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

async function sealMuratcanSignals() {
    const siteId = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073'; // Muratcan Akü

    console.log(`--- Sinyaller Mühürleniyor (Görüşüldü): Muratcan AKÜ ---`);

    // Get signals to seal
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
        console.error('Fetch error:', error.message);
        return;
    }

    const pendingIntents = intents?.filter(it => {
        const s = (it.status || '').toLowerCase();
        return !s || s === 'intent';
    }) || [];

    if (pendingIntents.length === 0) {
        console.log("Kuyrukta beklene sinyal bulunamadı.");
        return;
    }

    console.log(`Toplam ${pendingIntents.length} sinyal mühürlenecek...`);

    for (const it of pendingIntents) {
        // Fetch current version for optimistic locking
        const { data: currentCall } = await supabase.from('calls').select('version').eq('id', it.id).single();
        const version = currentCall?.version ?? 0;

        const confirmedAtIso = new Date().toISOString();
        const updatePayload = {
            sale_amount: null,
            currency: 'TRY',
            status: 'confirmed',
            confirmed_at: confirmedAtIso,
            lead_score: 100,
            oci_status: 'sealed',
            oci_status_updated_at: confirmedAtIso
        };

        const { data: updated, error: updateError } = await supabase.rpc('apply_call_action_v1', {
            p_call_id: it.id,
            p_action_type: 'seal',
            p_payload: updatePayload,
            p_actor_type: 'system',
            p_actor_id: null,
            p_metadata: { source: 'user-request-via-antigravity', system: 'antigravity-worker' },
            p_version: version
        });

        if (updateError) {
            console.error(`Sinyal ${it.id} mühürlenemedi:`, updateError.message);
        } else {
            console.log(`OK: Sinyal ${it.id} başarıyla mühürlendi.`);
        }
    }
    
    console.log("İşlem tamamlandı.");
}

sealMuratcanSignals();
