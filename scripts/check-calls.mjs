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

async function checkCalls() {
    const { data: calls } = await supabase
        .from('calls')
        .select('id, site_id, status, click_id, matched_session_id, created_at')
        .eq('source', 'click')
        .order('created_at', { ascending: false })
        .limit(20);

    if (!calls) return;

    console.table(calls.map(c => ({
        site: c.site_id.slice(0, 8),
        status: c.status,
        hasGclid: !!c.click_id,
        hasSession: !!c.matched_session_id,
        time: c.created_at.slice(0, 19)
    })));
}

checkCalls();
