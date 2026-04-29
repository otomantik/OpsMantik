
import { adminClient } from './lib/supabase/admin';

async function checkAdsDataQuality() {
  try {
    const { data: site } = await adminClient
      .from('sites')
      .select('id, domain')
      .ilike('domain', '%muratcanaku%')
      .single();

    if (!site) return;

    // Fetch sessions with GCLID and see their UTM/Metadata state
    const { data: sessions } = await adminClient
      .from('sessions')
      .select('id, gclid, utm_term, traffic_source, created_at')
      .eq('site_id', site.id)
      .not('gclid', 'is', null)
      .order('created_at', { ascending: false })
      .limit(20);

    console.log(`\n--- ADS DATA QUALITY: ${site.domain} ---`);
    sessions?.forEach((s, i) => {
      console.log(`[${i+1}] ID: ${s.id.slice(0,8)} | Time: ${s.created_at}`);
      console.log(`    GCLID: ${s.gclid.slice(0,10)}...`);
      console.log(`    KEYWORD (utm_term): ${s.utm_term || '❌ NULL'}`);
      console.log(`    SOURCE: ${s.traffic_source || '❌ NULL'}`);
      console.log('    --------------------------------');
    });

    // Check if there are ANY keywords at all in the whole history
    const { count: kwCount } = await adminClient
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .eq('site_id', site.id)
      .not('utm_term', 'is', null);

    console.log(`\nTotal sessions WITH keywords: ${kwCount}`);

  } catch (e) {
    console.error(e);
  }
}

checkAdsDataQuality();
