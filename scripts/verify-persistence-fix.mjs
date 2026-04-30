
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyFix() {
  console.log('Verifying Intent Persistence Fix...');
  
  // 1. Check get_recent_intents_lite_v1 logic by calling it and checking if it filters correctly.
  // We'll look for any session that has a 'won' call and ensure it returns NO intents.
  
  const { data: wonCalls } = await supabase
    .from('calls')
    .select('site_id, matched_session_id, id')
    .eq('status', 'won')
    .not('matched_session_id', 'is', null)
    .limit(5);

  if (!wonCalls || wonCalls.length === 0) {
    console.log('No won calls found to test session exclusion. Skipping SQL verification.');
  } else {
    for (const call of wonCalls) {
      console.log(`Checking exclusion for session: ${call.matched_session_id}`);
      const { data: liteRows } = await supabase.rpc('get_recent_intents_lite_v1', {
        p_site_id: call.site_id,
        p_date_from: '2020-01-01',
        p_date_to: '2030-01-01',
        p_limit: 100,
        p_ads_only: false
      });
      
      const found = liteRows?.find(r => r.matched_session_id === call.matched_session_id);
      if (found) {
        console.error(`BUG: Session ${call.matched_session_id} still has visible intents despite having a 'won' call!`);
        console.log('Found row:', found);
      } else {
        console.log(`SUCCESS: Session ${call.matched_session_id} correctly hidden.`);
      }
    }
  }

  // 2. Test apply_call_action_with_review_v1 signature
  console.log('Testing apply_call_action_with_review_v1 signature...');
  const { data: pending } = await supabase
    .from('calls')
    .select('id, site_id, version')
    .eq('status', 'intent')
    .limit(1);

  if (pending && pending.length > 0) {
    const p = pending[0];
    const { error } = await supabase.rpc('apply_call_action_with_review_v1', {
      p_call_id: p.id,
      p_site_id: p.site_id,
      p_stage: 'junk',
      p_actor_id: '00000000-0000-0000-0000-000000000000',
      p_lead_score: 0,
      p_version: p.version,
      p_reviewed: true,
      p_metadata: { source: 'verify-script' }
    });
    
    if (error) {
      console.error('apply_call_action_with_review_v1 FAILED:', error.message);
    } else {
      console.log('apply_call_action_with_review_v1 SUCCESS.');
    }
  }
}

verifyFix();
