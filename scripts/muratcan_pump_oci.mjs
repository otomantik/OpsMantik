import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { resolve } from 'path';
import crypto from 'crypto';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SITE_ID = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073'; // Muratcan AKÜ

function computeExternalId(input) {
  const providerKey = (input.providerKey || 'google_ads').trim().toLowerCase();
  const action = (input.action || 'purchase').trim().toLowerCase();
  const saleId = (input.saleId || '').trim().toLowerCase();
  const callId = (input.callId || '').trim().toLowerCase();
  const sessionId = (input.sessionId || '').trim().toLowerCase();

  const fingerprint = `${providerKey}|${action}|${saleId}|${callId}|${sessionId}`;
  return `oci_${crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 32)}`;
}

async function pump() {
  console.log('--- Muratcan OCI Kuyruğuna Pompalama Başlıyor ---');

  // Mühürlenmiş (confirmed) çağrıları bul (son 24 saat)
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: calls, error: callsError } = await supabase
    .from('calls')
    .select('id, matched_session_id, confirmed_at, currency')
    .eq('site_id', SITE_ID)
    .eq('status', 'confirmed')
    .gt('confirmed_at', yesterday);

  if (callsError) {
    console.error('Çağrılar çekilemedi:', callsError);
    return;
  }

  console.log(`${calls.length} mühürlü çağrı bulundu.`);

  for (const call of calls) {
    console.log(`İşleniyor: ${call.id}`);

    // Marketing signals'dan GCLID'yi bulalım (identity stitcher logic'i simüle ediyoruz)
    const { data: signals } = await supabase
      .from('marketing_signals')
      .select('gclid, wbraid, gbraid')
      .eq('call_id', call.id)
      .not('gclid', 'is', null)
      .limit(1);

    let gclid = signals?.[0]?.gclid || null;
    let wbraid = signals?.[0]?.wbraid || null;
    let gbraid = signals?.[0]?.gbraid || null;

    if (!gclid && !wbraid && !gbraid) {
      // Eğer signal'da yoksa session'a bakalım
      if (call.matched_session_id) {
        const { data: session } = await supabase
          .from('sessions')
          .select('gclid, wbraid, gbraid')
          .eq('id', call.matched_session_id)
          .single();
        
        gclid = session?.gclid || null;
        wbraid = session?.wbraid || null;
        gbraid = session?.gbraid || null;
      }
    }

    if (!gclid && !wbraid && !gbraid) {
      console.log(`Skipping ${call.id}: No click ID found.`);
      continue;
    }

    const externalId = computeExternalId({
      providerKey: 'google_ads',
      action: 'purchase',
      callId: call.id,
      sessionId: call.matched_session_id
    });

    const payload = {
      site_id: SITE_ID,
      call_id: call.id,
      session_id: call.matched_session_id,
      provider_key: 'google_ads',
      external_id: externalId,
      conversion_time: call.confirmed_at,
      occurred_at: call.confirmed_at,
      source_timestamp: call.confirmed_at,
      time_confidence: 'observed',
      occurred_at_source: 'fallback_confirmed',
      value_cents: 50000, // 500 TRY varsayılan mühür değeri
      currency: call.currency || 'TRY',
      gclid,
      wbraid,
      gbraid,
      status: 'QUEUED'
    };

    const { error: insertError } = await supabase
      .from('offline_conversion_queue')
      .insert(payload);

    if (insertError) {
      if (insertError.code === '23505') {
        console.log(`Call ${call.id} zaten kuyrukta.`);
      } else {
        console.error(`Call ${call.id} eklenemedi:`, insertError.message);
      }
    } else {
      console.log(`Call ${call.id} OCI kuyruğuna (V5) eklendi!`);
    }
  }
}

pump();
