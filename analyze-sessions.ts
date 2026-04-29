
import { adminClient } from './lib/supabase/admin';

async function analyzeSessions() {
  try {
    const { data: site } = await adminClient
      .from('sites')
      .select('id, domain')
      .ilike('domain', '%muratcanaku%')
      .single();

    if (!site) return;

    // Check latest sessions for UTMs
    const { data: sessions, error } = await adminClient
      .from('sessions')
      .select('id, utm_source, utm_medium, utm_campaign, utm_term, utm_content, created_at, gclid')
      .eq('site_id', site.id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('Error fetching sessions:', error);
      return;
    }

    console.log(`\n--- SESSIONS ANALYSIS: ${site.domain} ---`);
    sessions?.forEach((s, i) => {
      console.log(`[${i+1}] ID: ${s.id.slice(0,8)} | Time: ${s.created_at}`);
      console.log(`    GCLID: ${s.gclid || '❌ NULL'}`);
      console.log(`    SOURCE: ${s.utm_source || '❌ NULL'} | TERM: ${s.utm_term || '❌ NULL'}`);
      console.log('    --------------------------------');
    });

  } catch (e) {
    console.error(e);
  }
}

analyzeSessions();
