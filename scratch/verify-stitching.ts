
import { adminClient } from './lib/supabase/admin';

async function verifyLatestGclidStitching() {
  try {
    const { data: site } = await adminClient
      .from('sites')
      .select('id, domain')
      .ilike('domain', '%muratcanaku%')
      .single();

    if (!site) return;

    // 1. Find the latest session WITH a GCLID
    const { data: session } = await adminClient
      .from('sessions')
      .select('id, gclid, utm_term, created_at')
      .eq('site_id', site.id)
      .not('gclid', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!session) {
      console.log('No sessions with GCLID found for this site.');
      return;
    }

    console.log(`Found Latest GCLID Session: ${session.id}`);
    console.log(`GCLID: ${session.gclid}`);
    console.log(`Time: ${session.created_at}`);

    // 2. Find the CALL for this session
    const { data: call } = await adminClient
      .from('calls')
      .select('id, gclid, click_id, matched_session_id, created_at')
      .eq('matched_session_id', session.id)
      .single();

    if (call) {
      console.log(`\n✅ Call Found: ${call.id}`);
      console.log(`Call GCLID: ${call.gclid || '❌ NULL'}`);
      console.log(`Call ClickID: ${call.click_id || '❌ NULL'}`);
      
      if (!call.gclid && session.gclid) {
        console.log('\n🚨 STITCHING FAILURE DETECTED: GCLID present in session but missing in call!');
      }
    } else {
      console.log('\n⚠️ No call record found for this GCLID session yet.');
    }

  } catch (e) {
    console.error(e);
  }
}

verifyLatestGclidStitching();
