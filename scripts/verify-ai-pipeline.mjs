#!/usr/bin/env node
/**
 * AI Pipeline Kanıt Script — Hunter AI tetikleniyor mu, session güncelleniyor mu?
 *
 * .env.local'da SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY gerekir.
 *
 * Kullanım:
 *   node scripts/verify-ai-pipeline.mjs
 *   npx node scripts/verify-ai-pipeline.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ .env.local gerekli: NEXT_PUBLIC_SUPABASE_URL (veya SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function log(title, color = 'reset') {
  const codes = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m' };
  console.log(`${codes[color] || ''}${title}${codes.reset}`);
}

async function main() {
  log('\n=== AI PIPELINE KANIT RAPORU ===\n', 'cyan');

  // 1) Son high-intent call'lar (trigger sadece bunlar için çalışır)
  const { data: calls, error: callsErr } = await supabase
    .from('calls')
    .select('id, created_at, intent_action, matched_session_id')
    .eq('source', 'click')
    .in('intent_action', ['phone', 'whatsapp'])
    .order('created_at', { ascending: false })
    .limit(20);

  if (callsErr) {
    log('❌ calls sorgusu hatası: ' + callsErr.message, 'red');
    return;
  }

  const withSession = (calls || []).filter((c) => c.matched_session_id);
  log(`1) Son 20 high-intent call: ${(calls || []).length} adet (matched_session_id dolu: ${withSession.length})`, 'cyan');
  if ((calls || []).length === 0) {
    log('   → Henüz telefon/WhatsApp tıklaması yok; trigger hiç tetiklenmez. Site üzerinden tıklama yap.', 'yellow');
  } else {
    log(`   → En son call: ${calls[0]?.created_at} (${calls[0]?.intent_action})`, 'reset');
  }

  // 2) AI doldurulmuş session'lar (ai_score > 0 veya ai_summary var)
  const { data: sessionsWithAi, error: sessErr } = await supabase
    .from('sessions')
    .select('id, created_at, ai_score, ai_summary, ai_tags')
    .gt('ai_score', 0)
    .order('created_at', { ascending: false })
    .limit(10);

  if (sessErr) {
    log('❌ sessions sorgusu hatası: ' + sessErr.message, 'red');
    return;
  }

  const aiCount = (sessionsWithAi || []).length;
  log(`\n2) AI doldurulmuş session: ${aiCount} adet (ai_score > 0 veya ai_summary dolu)`, 'cyan');
  if (aiCount === 0) {
    log('   → Hiç session AI ile güncellenmemiş. Olasılıklar:', 'yellow');
    log('     - pg_net kapalı veya private.api_keys (project_url, service_role_key) eksik', 'yellow');
    log('     - hunter-ai Edge Function deploy edilmemiş', 'yellow');
    log('     - OPENAI_API_KEY Edge Function secret olarak verilmemiş', 'yellow');
    log('     - Edge Function hata veriyor (Dashboard → Edge Functions → hunter-ai → Logs)', 'yellow');
  } else {
    log(`   → En son AI session: ${sessionsWithAi[0]?.created_at} — ai_score: ${sessionsWithAi[0]?.ai_score}`, 'green');
    if (sessionsWithAi[0]?.ai_summary) {
      log(`   → Özet: ${String(sessionsWithAi[0].ai_summary).slice(0, 80)}...`, 'reset');
    }
  }

  // 3) Son high-intent call'ların session'ında ai dolu mu?
  const sessionIdsWithAi = new Set((sessionsWithAi || []).map((s) => s.id));
  let matchedWithAi = 0;
  for (const c of withSession) {
    if (sessionIdsWithAi.has(c.matched_session_id)) matchedWithAi++;
  }

  log(`\n3) Son ${withSession.length} eşleşmiş call'dan kaçının session'ında AI var: ${matchedWithAi}`, 'cyan');
  if (withSession.length > 0 && matchedWithAi === 0 && aiCount > 0) {
    log('   → Eski call\'lar AI öncesi olabilir; yeni bir telefon/WhatsApp tıklaması yap, 30 sn sonra tekrar çalıştır.', 'yellow');
  }
  if (withSession.length > 0 && matchedWithAi > 0) {
    log('   → Pipeline çalışıyor: call insert → trigger → hunter-ai → session güncelleniyor.', 'green');
  }

  log('\n--- Özet ---', 'cyan');
  if (aiCount > 0) {
    log('Kanıt: AI pipeline çalışıyor (en az bir session ai_score/ai_summary ile güncellenmiş).', 'green');
  } else if ((calls || []).length > 0) {
    log('Kanıt: High-intent call var ama hiç session AI ile güncellenmemiş → trigger veya hunter-ai tarafında sorun.', 'red');
    log('Kontrol: docs/WAR_ROOM/REPORTS/AI_SCORE_NEDEN_0_KONTROL_LISTESI.md + Edge Functions → hunter-ai → Logs', 'yellow');
  } else {
    log('Henüz high-intent call yok. Sitede telefon/WhatsApp tıklaması yapıp tekrar dene.', 'yellow');
  }
  log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
