// File: supabase/functions/hunter-ai/index.ts
// PHASE 2 — Hunter AI: Trigger'dan gelen high-intent call → Session + Timeline → OpenAI → sessions.ai_* güncelle.

// @ts-expect-error: URL imports are standard in Deno/Supabase Edge Functions
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error: URL imports are standard in Deno/Supabase Edge Functions
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// NOTE: Deno-specific imports above may show as errors in Node-based IDEs. 
// These modules are correctly resolved in the Supabase Edge Runtime.

/**
 * CRITICAL SECURITY GUARD (2026-02-05)
 *
 * - Removes wildcard CORS (no "*" allowed)
 * - Requires either:
 *   A) Shared secret in Authorization header (recommended for internal triggers), or
 *   B) A valid Supabase user JWT (if SUPABASE_ANON_KEY is configured for verification)
 *
 * IMPORTANT:
 * - Service-role Supabase client is created/used ONLY after auth passes.
 */

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const MODEL = "gpt-4o-mini";

type AuthResult =
  | { ok: true; mode: "shared_secret" }
  | { ok: true; mode: "user_jwt"; userId: string }
  | { ok: false };

function parseAllowlist(raw: string | null | undefined): string[] {
  if (!raw) return [];
  // Split by comma, remove all whitespace/newlines, filter empty.
  const parts = raw
    .split(",")
    .map((o) => o.replace(/\s/g, ""))
    .filter((o) => o.length > 0);
  // Explicitly disallow wildcard.
  return parts.filter((o) => o !== "*" && o.toLowerCase() !== "null");
}

const ALLOWED_ORIGINS = (() => {
  const raw =
    Deno.env.get("HUNTER_AI_ALLOWED_ORIGINS") ??
    // Optional fallback to the app-wide allowlist if you keep a single source of truth.
    Deno.env.get("ALLOWED_ORIGINS") ??
    "";
  return parseAllowlist(raw);
})();

function isOriginAllowed(origin: string | null, allowed: string[]): boolean {
  if (!origin) return true; // server-to-server calls (no browser Origin) should not be blocked by CORS
  if (allowed.length === 0) return false;
  const normalizedOrigin = origin.toLowerCase().trim().replace(/\/+$/, "");
  for (const a of allowed) {
    const normalizedAllowed = a.toLowerCase().trim().replace(/\/+$/, "");
    if (normalizedOrigin === normalizedAllowed) return true;
    // Allow host-only entries and subdomain matches (e.g., www.example.com -> example.com)
    try {
      const oUrl = new URL(normalizedOrigin);
      const aUrl = new URL(normalizedAllowed.includes("://") ? normalizedAllowed : `https://${normalizedAllowed}`);
      if (oUrl.hostname === aUrl.hostname) return true;
      if (oUrl.hostname.endsWith("." + aUrl.hostname)) return true;
    } catch {
      // ignore invalid URL forms
    }
  }
  return false;
}

function buildCorsHeaders(origin: string | null): Headers {
  const h = new Headers();
  h.set("Vary", "Origin");
  // Only echo ACAO for allowed origins; never use wildcard.
  if (origin && isOriginAllowed(origin, ALLOWED_ORIGINS)) {
    h.set("Access-Control-Allow-Origin", origin);
  }
  // Keep headers minimal; expand only if you need more.
  h.set("Access-Control-Allow-Headers", "authorization, content-type");
  h.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  h.set("Access-Control-Max-Age", "86400");
  return h;
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aa = enc.encode(a);
  const bb = enc.encode(b);
  if (aa.length !== bb.length) return false;
  let out = 0;
  for (let i = 0; i < aa.length; i++) out |= aa[i] ^ bb[i];
  return out === 0;
}

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const t = authHeader.trim();
  if (!t) return null;
  if (t.toLowerCase().startsWith("bearer ")) return t.slice(7).trim() || null;
  return t; // allow raw token/secret (still treated as "token")
}

function looksLikeJwt(token: string): boolean {
  // Minimal heuristic: three dot-separated segments.
  const parts = token.split(".");
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

async function authorizeRequest(req: Request): Promise<AuthResult> {
  const token = extractBearerToken(req.headers.get("authorization"));
  if (!token) return { ok: false };

  // A) Shared secret (recommended for internal triggers / server-to-server)
  const shared = Deno.env.get("HUNTER_AI_SHARED_SECRET");
  if (shared && shared.length > 0) {
    if (timingSafeEqual(token, shared)) return { ok: true, mode: "shared_secret" };
  }

  // B) Supabase user JWT verification (optional; requires SUPABASE_ANON_KEY to verify)
  if (looksLikeJwt(token)) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (supabaseUrl && anonKey) {
      const authClient = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await authClient.auth.getUser(token);
      if (!error && data?.user?.id) {
        return { ok: true, mode: "user_jwt", userId: data.user.id };
      }
    }
  }

  return { ok: false };
}

serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const corsHeaders = buildCorsHeaders(origin);

  // Strict CORS for browser calls (no wildcard). Preflight is handled here.
  if (req.method === "OPTIONS") {
    const allowed = isOriginAllowed(origin, ALLOWED_ORIGINS);
    // If origin is missing, treat it as non-browser; reply OK without ACAO.
    return new Response(null, {
      status: allowed ? 204 : 403,
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    const h = new Headers(corsHeaders);
    h.set("Allow", "POST, OPTIONS");
    h.set("Content-Type", "application/json");
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: h });
  }

  // --- AUTH GUARD (MUST run before any service-role access) ---
  const auth = await authorizeRequest(req);
  if (!auth.ok) {
    const h = new Headers(corsHeaders);
    h.set("Content-Type", "application/json");
    h.set("WWW-Authenticate", 'Bearer realm="hunter-ai"');
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: h });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }

    // Create service-role client ONLY after authorization succeeded.
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

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
      { headers: new Headers({ ...Object.fromEntries(corsHeaders.entries()), "Content-Type": "application/json" }) }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Hunter AI] Error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: new Headers({ ...Object.fromEntries(corsHeaders.entries()), "Content-Type": "application/json" }),
    });
  }
});
