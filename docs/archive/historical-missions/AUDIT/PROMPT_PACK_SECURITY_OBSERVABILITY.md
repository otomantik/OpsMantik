# Prompt Pack (Security + Observability) — OpsMantik
*Audience:* AI coding agent working inside this repo  
*Language:* English  
*Goal:* Execute critical security/PII fixes and produce a scored audit report.  

## How to use this pack
- Run prompts **in order**.  
- Each prompt is designed to be **copy-pasted** as-is to an AI coding agent.  
- The agent should use repo tools to read files before editing, run checks, and keep changes minimal and reviewable.  

---

## Prompt 1 — Context Intake (Context Engineer)
You are a Security + DevOps engineer. Before changing anything, build a minimal but sufficient mental model of the system and enumerate high-risk flows.

### Tasks
- Read:
  - `package.json`, `next.config.ts`, `middleware.ts`
  - `instrumentation.ts`, `instrumentation-client.ts`
  - `sentry.server.config.ts`, `sentry.edge.config.ts`
  - `supabase/functions/hunter-ai/index.ts`
  - `lib/sentry-pii.ts`, `lib/cors.ts`
  - `.github/workflows/e2e.yml`, `.github/workflows/smoke.yml`
- Identify:
  - All public ingress points (Next route handlers, Supabase Edge Functions).
  - Any locations where PII can leak (headers, IP, cookies, auth tokens, request bodies).
  - Any service-role usage and whether it is gated by auth.

### Output
- A short system map (bullets).
- A risk list with severity (P0/P1/P2) and evidence (file + line range).
- A concrete plan for the next prompts (what you will change and why).

Constraints:
- Do not commit or push.
- Do not introduce new dependencies unless absolutely required.

---

## Prompt 2 — Critical Fix: Secure `hunter-ai` Supabase Edge Function (Prompt Engineer)
Act as a Security Engineer.

### Objective
Secure `supabase/functions/hunter-ai/index.ts` immediately to prevent unauthorized access and wildcard CORS exposure.

### Requirements
1. **Remove wildcard CORS**
   - Change `Access-Control-Allow-Origin` from `"*"` to a strict allowlist.
   - Prefer **env-configurable allowlist**:
     - `HUNTER_AI_ALLOWED_ORIGINS` (preferred)
     - optional fallback to `ALLOWED_ORIGINS` if that is the repo convention
   - Never emit `*` in responses.
   - For preflight:
     - If the request has an `Origin`, return `204` only when allowed, else `403`.
     - If `Origin` is missing (server-to-server), do not block solely on CORS.

2. **Implement an auth guard (early 401)**
   Accept either of the following:
   - **Shared secret** in `Authorization` header:
     - Env: `HUNTER_AI_SHARED_SECRET`
     - Header: `Authorization: Bearer <secret>` (or accept raw token too)
   - **OR** a valid Supabase user JWT:
     - Verify token via `supabase.auth.getUser(token)`
     - Requires `SUPABASE_ANON_KEY` to be present for verification

   If auth fails, return **401 Unauthorized immediately**.

3. **Gate service-role**
   - Ensure the service-role Supabase client is only created/used **after** auth passes.

4. **Method hardening**
   - Allow only `POST` and `OPTIONS`.
   - Return `405` for other methods with `Allow: POST, OPTIONS`.

### Deliverables
- Patch `supabase/functions/hunter-ai/index.ts` accordingly.
- Provide a short “Secrets to set” list for Supabase Edge Function configuration.

Constraints:
- Keep code dependency-free (no external libraries).
- Use timing-safe comparison for shared secret.

---

## Prompt 3 — Critical Fix: Prevent PII leakage in Sentry server-side configs
Act as a DevOps + Security engineer.

### Objective
Make server/edge Sentry match client-side privacy posture (no default PII; scrub sensitive headers).

### Requirements
1. Update:
   - `sentry.server.config.ts`
   - `sentry.edge.config.ts`
2. Set:
   - `sendDefaultPii: false`
3. Add `beforeSend` hook:
   - Use or import `scrubEventPii`
   - Ensure scrubbing removes:
     - `Cookie`, `Set-Cookie`, `Authorization` headers (case-insensitive)
     - Sanitizes user IP address (`event.user.ip_address`) and common IP headers (`x-forwarded-for`, `x-real-ip`, etc.)
4. Ensure this matches client-side privacy level:
   - Compare with `instrumentation-client.ts` behavior and align.

### Deliverables
- Minimal diffs for the 2 Sentry config files.
- If needed, update `lib/sentry-pii.ts` to implement the header/IP scrubbing centrally.

Constraints:
- No breaking changes to build.
- Do not increase data sent to Sentry.

---

## Prompt 4 — Verification Prompt (DevOps)
Act as a DevOps engineer.

### Objective
Verify the critical fixes did not break the project and that the security guarantees hold.

### Tasks
- Run:
  - `npm run lint`
  - `npm audit --omit=dev`
- Confirm by code inspection:
  - `hunter-ai` no longer returns `Access-Control-Allow-Origin: *`
  - `hunter-ai` returns `401` without Authorization
  - `hunter-ai` uses service-role only after auth passes
  - Sentry server/edge has `sendDefaultPii: false` and `beforeSend` scrubbing

### Output
- Paste command results summary (errors vs warnings).
- A checklist of the guarantees above with “PASS/FAIL” and file evidence.

Constraints:
- Do not commit or push.

---

## Prompt 5 — System Scan + Score (Audit Engineer)
Act as a Security/Platform auditor. Produce a scored evaluation of the repo after the fixes.

### Objective
Provide a scorecard (0–100) with categories and actionable next steps.

### Required categories
- Security & Privacy
- CI/CD & Operational Readiness
- Observability
- Code Quality & Maintainability
- Performance & Scalability
- Testing Coverage
- Documentation

### Output format
- Overall score + category scores.
- Top 5 remaining risks with severity and evidence.
- Top 5 recommended improvements (P1/P2) with “why it matters”.

Constraints:
- Keep it concise (high signal).

