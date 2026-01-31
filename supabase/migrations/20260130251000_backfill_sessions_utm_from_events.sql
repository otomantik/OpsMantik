-- HunterCard Data Correctness v1: backfill UTM/matchtype/ads from first event URL
-- when session has gclid but UTM nulls (entry_page had no query string).
-- Depends on public.get_url_param (20260130250700).

WITH first_event AS (
  SELECT DISTINCT ON (e.session_id, e.session_month)
    e.session_id,
    e.session_month,
    e.url
  FROM public.events e
  INNER JOIN public.sessions s
    ON s.id = e.session_id AND s.created_month = e.session_month
  WHERE s.gclid IS NOT NULL
    AND (s.utm_term IS NULL OR s.matchtype IS NULL OR s.utm_campaign IS NULL)
    AND e.url LIKE '%?%'
  ORDER BY e.session_id, e.session_month, e.created_at ASC
)
UPDATE public.sessions s
SET
  utm_source    = COALESCE(public.get_url_param(fe.url, 'utm_source'),   s.utm_source),
  utm_medium    = COALESCE(public.get_url_param(fe.url, 'utm_medium'),   s.utm_medium),
  utm_campaign  = COALESCE(public.get_url_param(fe.url, 'utm_campaign'), s.utm_campaign),
  utm_content   = COALESCE(public.get_url_param(fe.url, 'utm_content'),   s.utm_content),
  utm_term      = COALESCE(public.get_url_param(fe.url, 'utm_term'),      s.utm_term),
  matchtype     = COALESCE(public.get_url_param(fe.url, 'matchtype'),   s.matchtype),
  ads_network   = COALESCE(public.get_url_param(fe.url, 'network'),     s.ads_network),
  ads_placement = COALESCE(public.get_url_param(fe.url, 'placement'),    s.ads_placement),
  device_type   = CASE
    WHEN lower(public.get_url_param(fe.url, 'device')) IN ('mobile','desktop','tablet')
    THEN COALESCE(lower(public.get_url_param(fe.url, 'device')), s.device_type)
    ELSE s.device_type
  END
FROM first_event fe
WHERE s.id = fe.session_id AND s.created_month = fe.session_month;
