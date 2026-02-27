-- P0 Intent Repair: Event var ama call yok
--
-- Kök neden: ON CONFLICT (site_id, intent_stamp) için UNIQUE constraint eksik.
-- Migration 20260227150000_restore_calls_site_intent_stamp_uniq.sql bunu düzeltir.
-- Önce migration'ı uygula: supabase db push veya migration apply.
--
-- Ardından RPC çalışacak. Manuel deneme (migration sonrası):
-- sid: 581b9b75-ff81-432b-b829-3a3b0b8f3e2f
-- site_id (internal): eef6bf9f-48ad-4611-bb74-0f0171843ab6

SELECT public.ensure_session_intent_v1(
  'eef6bf9f-48ad-4611-bb74-0f0171843ab6'::uuid,  -- p_site_id (internal)
  '581b9b75-ff81-432b-b829-3a3b0b8f3e2f'::uuid,  -- p_session_id (sid)
  'fp_regression_test',                           -- p_fingerprint
  0,                                              -- p_lead_score
  'phone',                                        -- p_intent_action
  'tel:+905000000000',                            -- p_intent_target
  'https://example.test/landing?gclid=TEST',      -- p_intent_page_url
  'TEST'                                          -- p_click_id
);

-- Başarılıysa call_id döner. Sonra kontrol et:
-- SELECT id, matched_session_id, source, status FROM public.calls
-- WHERE matched_session_id = '581b9b75-ff81-432b-b829-3a3b0b8f3e2f';
