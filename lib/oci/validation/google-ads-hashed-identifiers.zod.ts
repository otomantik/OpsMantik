/**
 * PR-9H.8 — Zod contract for Google Ads courier hashes (64-char lowercase hex per Google hex law).
 * Output of `fetch_oci_google_ads_export_jit_v1` rows is parsed through `jitExportRpcRowSchema` before export build.
 */

import { z } from 'zod';

/** Google / Koç script: only `[a-f0-9]{64}` — uppercase is rejected and must not reach UrlFetch payloads. */
export const googleAdsSha256Hex64Schema = z
  .string()
  .length(64)
  .regex(/^[a-f0-9]+$/, 'SHA-256 hex must be lowercase a-f0-9 only');

const jitSha256Hex64Nullable = z.preprocess(
  (v) => (v == null || v === '' ? null : String(v).trim().toLowerCase()),
  z.union([z.null(), googleAdsSha256Hex64Schema])
);

export const jitExportRpcRowSchema = z.object({
  id: z.string().uuid(),
  site_id: z.string().uuid(),
  status: z.string().nullable().optional(),
  sale_id: z.union([z.string().uuid(), z.null()]),
  call_id: z.union([z.string().uuid(), z.null()]),
  session_id: z.union([z.string().uuid(), z.null()]),
  gclid: z.string().nullable(),
  wbraid: z.string().nullable(),
  gbraid: z.string().nullable(),
  user_identifiers: z.unknown().nullable(),
  provider_path: z.string().nullable(),
  conversion_time: z.coerce.string(),
  occurred_at: z.coerce.string().nullable().optional(),
  created_at: z.coerce.string().nullable().optional(),
  updated_at: z.coerce.string().nullable().optional(),
  value_cents: z.coerce.number().int(),
  optimization_stage: z.string().nullable().optional(),
  optimization_value: z.coerce.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  action: z.string().nullable().optional(),
  external_id: z.coerce.string(),
  provider_key: z.string().nullable().optional(),
  jit_call_status: z.string().nullable().optional(),
  jit_call_oci_status: z.string().nullable().optional(),
  jit_call_matched_session_id: z.union([z.string().uuid(), z.null()]).optional(),
  jit_call_created_at: z.coerce.string().nullable().optional(),
  jit_call_confirmed_at: z.coerce.string().nullable().optional(),
  jit_caller_phone_hash_sha256: jitSha256Hex64Nullable.optional(),
});

export type JitExportRpcRow = z.infer<typeof jitExportRpcRowSchema>;

/** Script courier: Koç / fleet expect `{ type: 'hashed_phone'|'hashed_email', value: '<64hex>' }`. */
export type ScriptCourierUserIdentifier = { type: 'hashed_phone' | 'hashed_email'; value: string };

export function buildScriptCourierUserIdentifiers(params: {
  phoneHex: string | null | undefined;
  emailHex: string | null | undefined;
}): ScriptCourierUserIdentifier[] {
  const out: ScriptCourierUserIdentifier[] = [];
  const phone = params.phoneHex != null ? googleAdsSha256Hex64Schema.safeParse(params.phoneHex.trim().toLowerCase()) : null;
  if (phone?.success) out.push({ type: 'hashed_phone', value: phone.data });
  const email = params.emailHex != null ? googleAdsSha256Hex64Schema.safeParse(params.emailHex.trim().toLowerCase()) : null;
  if (email?.success) out.push({ type: 'hashed_email', value: email.data });
  return out;
}

/**
 * Reconcile top-level courier fields + userIdentifiers array under Google hex law.
 * Invalid phone/email hex is stripped; click ids (gclid / wbraid / gbraid) are left unchanged.
 */
export function applyCourierZodArmorToConversionItem<T extends { gclid?: string; wbraid?: string; gbraid?: string }>(
  item: T & {
    hashedPhoneNumber?: string | null;
    hashed_phone_number?: string | null;
    hashed_email?: string | null;
    userIdentifiers?: ScriptCourierUserIdentifier[];
    user_identifiers?: ScriptCourierUserIdentifier[];
  }
): T & {
  hashedPhoneNumber?: string | null;
  hashed_phone_number?: string | null;
  hashed_email?: string | null;
  userIdentifiers?: ScriptCourierUserIdentifier[];
  user_identifiers?: ScriptCourierUserIdentifier[];
} {
  const rawPhone = item.hashedPhoneNumber ?? item.hashed_phone_number ?? null;
  const rawEmail = item.hashed_email ?? null;

  const phoneOk =
    rawPhone != null ? googleAdsSha256Hex64Schema.safeParse(String(rawPhone).trim().toLowerCase()) : null;
  const emailOk =
    rawEmail != null ? googleAdsSha256Hex64Schema.safeParse(String(rawEmail).trim().toLowerCase()) : null;

  const phoneHex = phoneOk?.success ? phoneOk.data : null;
  const emailHex = emailOk?.success ? emailOk.data : null;

  const merged = buildScriptCourierUserIdentifiers({ phoneHex, emailHex });

  const baseList = [...(item.userIdentifiers ?? item.user_identifiers ?? [])];
  for (const ent of baseList) {
    if (!ent || typeof ent !== 'object') continue;
    const tpe = String((ent as { type?: string }).type || '')
      .trim()
      .toLowerCase();
    const val = (ent as { value?: unknown }).value;
    if (tpe !== 'hashed_phone' && tpe !== 'hashed_email') continue;
    const parsed = googleAdsSha256Hex64Schema.safeParse(String(val ?? '').trim().toLowerCase());
    if (!parsed.success) continue;
    if (!merged.some((x) => x.type === tpe && x.value === parsed.data)) {
      merged.push({ type: tpe as 'hashed_phone' | 'hashed_email', value: parsed.data });
    }
  }

  const next = { ...item } as T & {
    hashedPhoneNumber?: string | null;
    hashed_phone_number?: string | null;
    hashed_email?: string | null;
    userIdentifiers?: ScriptCourierUserIdentifier[];
    user_identifiers?: ScriptCourierUserIdentifier[];
  };

  if (phoneHex) {
    next.hashedPhoneNumber = phoneHex;
    next.hashed_phone_number = phoneHex;
  } else {
    delete next.hashedPhoneNumber;
    delete next.hashed_phone_number;
  }
  if (emailHex) {
    next.hashed_email = emailHex;
  } else {
    delete next.hashed_email;
  }
  if (merged.length > 0) {
    next.userIdentifiers = merged;
    next.user_identifiers = merged;
  } else {
    delete next.userIdentifiers;
    delete next.user_identifiers;
  }

  return next;
}

export function parseJitExportRpcRowsStrict(raw: unknown): JitExportRpcRow[] {
  if (!Array.isArray(raw)) {
    throw new Error('OCI_EXPORT_JIT_RESPONSE_NOT_ARRAY');
  }
  const out: JitExportRpcRow[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = jitExportRpcRowSchema.safeParse(raw[i]);
    if (!r.success) {
      throw new Error(`OCI_EXPORT_JIT_ROW_${i}: ${r.error.message}`);
    }
    out.push(r.data);
  }
  return out;
}
