# hunter-ai

PHASE 2 — Hunter AI Edge Function. Trigger'dan (pg_net) gelen high-intent call payload'ını alır; session + timeline çeker, OpenAI ile analiz eder, `sessions.ai_score`, `ai_summary`, `ai_tags` günceller.

## Deploy

```bash
supabase functions deploy hunter-ai
```

## Secret (Zorunlu)

Deploy etmeden önce OpenAI API key'i tanımla:

```bash
supabase secrets set OPENAI_API_KEY=sk-...
```

(Veya Dashboard → Edge Functions → hunter-ai → Secrets.)

## Tetikleyici

`public.calls` tablosuna high-intent satır INSERT edildiğinde (source='click', intent_action in ('phone','whatsapp')) trigger `private.api_keys` ile URL/key alıp bu fonksiyona POST atar.

## Girdi (Body)

```json
{
  "type": "INSERT",
  "table": "calls",
  "record": { "id", "matched_session_id", "site_id", "intent_action", "intent_target", "intent_page_url", ... }
}
```

## Çıktı

- HTTP 200: `{ "success": true, "ai_score", "ai_summary", "ai_tags" }`
- `sessions` tablosunda ilgili session için `ai_score`, `ai_summary`, `ai_tags` güncellenir.
