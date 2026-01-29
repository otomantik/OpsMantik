// File: supabase/functions/hunter-ai/index.ts
// PHASE 2 — Hunter AI: Trigger'dan gelen high-intent call → Session + Timeline → OpenAI → sessions.ai_* güncelle.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const MODEL = "gpt-4o-mini";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const payload = await req.json();
    const record = payload?.record;

    if (!record || !record.matched_session_id) {
      throw new Error("Invalid payload: Missing record or matched_session_id");
    }

    console.log(`[Hunter AI] Processing Intent: ${record.id} for Session: ${record.matched_session_id}`);

    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("*")
      .eq("id", record.matched_session_id)
      .single();

    if (sessionError || !session) {
      throw new Error(`Session lookup failed: ${sessionError?.message}`);
    }

    let timeline: { event_category?: string; event_action?: string; event_label?: string; url?: string; created_at?: string }[] = [];
    const { data: timelineData, error: timelineError } = await supabase.rpc("get_session_timeline", {
      p_site_id: session.site_id,
      p_session_id: record.matched_session_id,
      p_limit: 50,
    });

    if (!timelineError && Array.isArray(timelineData) && timelineData.length > 0) {
      timeline = timelineData;
    } else {
      const { data: events } = await supabase
        .from("events")
        .select("event_category, event_action, event_label, url, created_at")
        .eq("session_id", record.matched_session_id)
        .eq("session_month", session.created_month)
        .order("created_at", { ascending: true })
        .limit(20);
      timeline = events ?? [];
    }

    const promptSystem = `
Sen Türkçe konuşan profesyonel bir satış analistisin (Lead Qualifier).
Görev: Bir web sitesi ziyaretçisinin davranışlarını ve son aksiyonunu analiz edip, satış ihtimalini (0-100) puanlamak ve kısa bir özet çıkarmak.

Kurallar:
1. Çıktı SADECE JSON formatında olacak.
2. PII (Kişisel Veri) asla özete ekleme (Telefon numarasını yazma).
3. 'ai_tags' dizisi için şu etiketleri kullanabilirsin: 'high-intent', 'whatsapp', 'phone', 'fiyat-odakli', 'acil', 'konum-var', 'reklam-trafigi'.
4. Özet 1-2 cümle, net ve Türkçe olsun.
`;

    const timelineStr = timeline
      .map((e) => `${e.event_category ?? ""}/${e.event_action ?? ""} @ ${e.url ?? ""}`)
      .join(" -> ");
    const promptUser = `
SESSION DETAYLARI:
- Giriş: ${session.entry_page ?? ""}
- Kaynak: ${session.utm_source ?? session.attribution_source ?? "Direkt"}
- Şehir: ${session.city ?? "Bilinmiyor"}

ZAMAN ÇİZELGESİ (Son Hareketler):
${timelineStr || "(veri yok)"}

SON KRİTİK AKSİYON (TETİKLEYİCİ):
- Tür: ${record.intent_action} (High Intent)
- Sayfa: ${record.intent_page_url ?? ""}

Analiz et ve JSON dön: { "ai_score": number, "ai_summary": string, "ai_tags": string[] }
`;

    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY not set in Edge Function secrets");
    }

    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: promptSystem },
          { role: "user", content: promptUser },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
      }),
    });

    const aiData = await aiResponse.json();
    if (aiData.error) {
      throw new Error(`OpenAI API Error: ${aiData.error.message}`);
    }

    const content = aiData.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenAI returned empty content");
    const result = JSON.parse(content);

    const aiScore = Math.min(100, Math.max(0, Number(result.ai_score) ?? 0));
    const aiSummary = typeof result.ai_summary === "string" ? result.ai_summary : null;
    const aiTags = Array.isArray(result.ai_tags) ? result.ai_tags : [];

    console.log(`[Hunter AI] Analysis Complete. Score: ${aiScore}`);

    const { error: updateError } = await supabase
      .from("sessions")
      .update({
        ai_score: aiScore,
        ai_summary: aiSummary,
        ai_tags: aiTags,
      })
      .eq("id", record.matched_session_id);

    if (updateError) throw updateError;

    return new Response(
      JSON.stringify({ success: true, ai_score: aiScore, ai_summary: aiSummary, ai_tags: aiTags }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Hunter AI] Error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
