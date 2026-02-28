BEGIN;

-- 1. Sinyal Geçmişi Tablosu (Append-Only)
CREATE TABLE IF NOT EXISTS public.marketing_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE RESTRICT,
  call_id uuid REFERENCES public.calls(id) ON DELETE SET NULL,

  -- Sinyal Detayları
  signal_type text NOT NULL, -- Örn: 'FORM_SUBMITTED', 'SEAL_PENDING'
  google_conversion_name text NOT NULL, -- Örn: 'OpsMantik_Lead', 'OpsMantik_Qualified'
  google_conversion_time timestamptz NOT NULL DEFAULT now(),

  -- Kuyruk Durumu
  dispatch_status text NOT NULL DEFAULT 'PENDING' CHECK (dispatch_status IN ('PENDING', 'SENT', 'FAILED')),
  google_sent_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.marketing_signals IS 'Olay Kaynaklı Sinyal Matrisi. Google Ads Observation/Optimization sinyalleri için zaman damgalı geçmiş.';

-- 2. APPEND-ONLY Koruması (Asla güncellenemez/silinemez - Sadece status değişebilir)
CREATE OR REPLACE FUNCTION public._marketing_signals_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'marketing_signals tablosundan veri silinemez (Append-Only).';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- Sadece dispatch_status ve google_sent_at güncellenebilir (Kuyruk işleyicisi için)
    IF NEW.site_id != OLD.site_id OR NEW.signal_type != OLD.signal_type OR NEW.google_conversion_name != OLD.google_conversion_name THEN
      RAISE EXCEPTION 'Sinyal içeriği değiştirilemez. Sadece status güncellenebilir.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_append_only_signals ON public.marketing_signals;
CREATE TRIGGER enforce_append_only_signals
  BEFORE UPDATE OR DELETE ON public.marketing_signals
  FOR EACH ROW EXECUTE FUNCTION public._marketing_signals_append_only();

-- Performans İndeksi (Script'in sadece PENDING olanları hızlıca bulması için)
CREATE INDEX idx_marketing_signals_pending ON public.marketing_signals (site_id, created_at) WHERE dispatch_status = 'PENDING';

ALTER TABLE public.marketing_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "marketing_signals_service_role"
  ON public.marketing_signals FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');

GRANT ALL ON public.marketing_signals TO service_role;

COMMIT;
