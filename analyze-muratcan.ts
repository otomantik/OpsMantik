
import { adminClient } from './lib/supabase/admin';

async function deepAnalyze() {
  try {
    const { data: site } = await adminClient
      .from('sites')
      .select('id, domain')
      .ilike('domain', '%muratcanaku%')
      .single();

    if (!site) return;

    // 1. Get ALL column names
    const { data: oneRecord } = await adminClient.from('calls').select('*').limit(1).single();
    const columns = Object.keys(oneRecord || {});
    console.log('--- TABLE COLUMNS ---');
    console.log(columns.join(', '));

    // 2. Check if ANY GCLID ever existed for this site
    const { count: gclidCount } = await adminClient
      .from('calls')
      .select('*', { count: 'exact', head: true })
      .eq('site_id', site.id)
      .not('gclid', 'is', null);

    console.log(`\nTotal GCLID records for this site: ${gclidCount}`);

    // 3. Find the latest GCLID record if any
    const { data: lastGclid } = await adminClient
      .from('calls')
      .select('*')
      .eq('site_id', site.id)
      .not('gclid', 'is', null)
      .order('created_at', { ascending: false })
      .limit(5);

    if (lastGclid && lastGclid.length > 0) {
      console.log('\n--- LATEST GCLID RECORDS ---');
      lastGclid.forEach(c => {
        console.log(`ID: ${c.id.slice(0,8)} | Time: ${c.created_at} | GCLID: ${c.gclid.slice(0,10)}... | KW: ${c.utm_term || c.keyword || 'NULL'}`);
      });
    } else {
      console.log('\n❌ NO GCLID RECORDS FOUND FOR THIS SITE RECENTLY');
    }

  } catch (e) {
    console.error(e);
  }
}

deepAnalyze();
