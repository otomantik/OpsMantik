
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

const siteId = 'e8ccaf80-23bc-49de-9eb6-114010c81d43';

async function checkSite() {
    console.log('Checking siteId:', siteId);
    console.log('Stripped siteId:', siteId.replace(/-/g, ''));

    const { data, error } = await supabase
        .from('sites')
        .select('id, public_id')
        .or(`public_id.eq."${siteId}",public_id.eq."${siteId.replace(/-/g, '')}"`);

    if (error) {
        console.error('Error:', error);
    } else if (data && data.length > 0) {
        console.log('Site found:', data);
    } else {
        console.log('Site NOT found');

        // List first 5 sites to see what's available
        const { data: allSites } = await supabase.from('sites').select('public_id').limit(5);
        console.log('Available sites (first 5):', allSites);
    }
}

checkSite();
