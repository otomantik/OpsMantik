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

async function checkDuplicates() {
    const { data: sites } = await supabase.from('sites').select('id, name, domain, public_id');
    if (!sites) return;

    const pubMap = new Map();
    for (const s of sites) {
        const pub = (s.public_id || '').toLowerCase();
        if (pubMap.has(pub)) {
            console.log(`Duplicate found! PubID: ${pub}`);
            console.log(`  Site 1: ${pubMap.get(pub).name} (${pubMap.get(pub).domain})`);
            console.log(`  Site 2: ${s.name} (${s.domain})`);
        } else {
            pubMap.set(pub, s);
        }
    }
}

checkDuplicates();
