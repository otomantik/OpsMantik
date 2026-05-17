
import { adminClient } from './lib/supabase/admin';

async function healGclidDataRobust() {
  try {
    console.log('--- STARTING ROBUST GCLID HEALING ---');
    
    // 1. Fetch records that need healing
    const { data: records, error } = await adminClient
      .from('calls')
      .select('id, click_id')
      .is('gclid', null)
      .not('click_id', 'is', null);

    if (error) {
      console.error('Fetch error:', error);
      return;
    }

    if (!records || records.length === 0) {
      console.log('No records found that require healing.');
      return;
    }

    console.log(`Found ${records.length} records to heal. Starting batch update...`);

    let healedCount = 0;
    for (const r of records) {
      const { error: upError } = await adminClient
        .from('calls')
        .update({ gclid: r.click_id })
        .eq('id', r.id);
      
      if (!upError) {
        healedCount++;
      }
    }

    console.log(`--- HEALING COMPLETE ---`);
    console.log(`Successfully updated ${healedCount} out of ${records.length} records.`);

  } catch (e) {
    console.error(e);
  }
}

healGclidDataRobust();
