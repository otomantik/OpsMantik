
import { adminClient } from './lib/supabase/admin.ts';

const siteId = 'e8ccaf80-23bc-49de-9eb6-114010c81d43';

async function checkSite() {
    const { data, error } = await adminClient
        .from('sites')
        .select('id, public_id')
        .or(`public_id.eq.${siteId},public_id.eq.${siteId.replace(/-/g, '')}`)
        .maybeSingle();

    if (error) {
        console.error('Error:', error);
    } else if (data) {
        console.log('Site found:', data);
    } else {
        console.log('Site NOT found');
    }
}

checkSite();
