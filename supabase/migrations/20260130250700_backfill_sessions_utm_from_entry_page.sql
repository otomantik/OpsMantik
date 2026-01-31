-- Backfill: GCLID'li tüm session kayıtlarında entry_page URL'sinden UTM ve şablon
-- parametrelerini çıkarıp yeni UTM/ads sütunlarına yaz (sadece boş olanları doldur).

-- Helper: URL query string'inden tek parametre değeri döndür (regex ile).
CREATE OR REPLACE FUNCTION public.get_url_param(p_url text, p_param text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT (regexp_match(substring(p_url from '\?(.*)$'), p_param || '=([^&]*)'))[2];
$$;

COMMENT ON FUNCTION public.get_url_param(text, text) IS 'Extract single query param value from URL (for backfill).';

-- GCLID'li ve entry_page'de query string olan session'ları güncelle.
-- COALESCE ile sadece şu an NULL olan sütunları dolduruyoruz.
UPDATE public.sessions
SET
  utm_source   = COALESCE(public.get_url_param(entry_page, 'utm_source'),   utm_source),
  utm_medium   = COALESCE(public.get_url_param(entry_page, 'utm_medium'),   utm_medium),
  utm_campaign = COALESCE(public.get_url_param(entry_page, 'utm_campaign'), utm_campaign),
  utm_content  = COALESCE(public.get_url_param(entry_page, 'utm_content'),  utm_content),
  utm_term     = COALESCE(public.get_url_param(entry_page, 'utm_term'),     utm_term),
  matchtype    = COALESCE(public.get_url_param(entry_page, 'matchtype'),    matchtype),
  ads_network  = COALESCE(public.get_url_param(entry_page, 'network'),      ads_network),
  ads_placement= COALESCE(public.get_url_param(entry_page, 'placement'),    ads_placement),
  device_type  = CASE
    WHEN lower(public.get_url_param(entry_page, 'device')) IN ('mobile','desktop','tablet')
    THEN COALESCE(lower(public.get_url_param(entry_page, 'device')), device_type)
    ELSE device_type
  END
WHERE gclid IS NOT NULL
  AND entry_page IS NOT NULL
  AND entry_page LIKE '%?%';
