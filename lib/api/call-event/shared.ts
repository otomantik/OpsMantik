export type EventIdMode = 'off' | 'on' | 'auto';

export function getEventIdModeFromEnv(): EventIdMode {
  const raw = (process.env.CALL_EVENT_EVENT_ID_COLUMN_ENABLED || '').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off') return 'off';
  if (raw === '1' || raw === 'true' || raw === 'on') return 'on';
  return 'auto';
}

export function isMissingEventIdColumnError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  const code = (e?.code || '').toString();
  const msg = (e?.message || '').toString().toLowerCase();
  if (!msg.includes('event_id')) return false;
  // Postgres undefined_column: 42703. PostgREST can surface as PGRST204.
  if (code === '42703' || code === 'PGRST204') return true;
  if (msg.includes('does not exist') || msg.includes('could not find') || msg.includes('not found')) return true;
  return false;
}

export function isMissingResolveRpcError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  const code = (e?.code || '').toString();
  const msg = (e?.message || '').toString().toLowerCase();
  if (code.startsWith('PGRST') && msg.includes('resolve_site_identifier_v1')) return true;
  if (msg.includes('resolve_site_identifier_v1') && (msg.includes('does not exist') || msg.includes('not found'))) return true;
  return false;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function normalizeDialTarget(raw: string): string | null {
  const normalized = raw.replace(/[^\d+]/g, '');
  return normalized.length > 0 ? normalized : null;
}

function canonicalizeWhatsAppTarget(raw: string): string | null {
  const t = raw.trim();
  const lower = t.toLowerCase();
  if (
    !lower.startsWith('whatsapp:') &&
    !lower.startsWith('whatsapp://') &&
    !lower.includes('wa.me') &&
    !lower.includes('whatsapp.com') &&
    !lower.includes('chat.whatsapp.com') &&
    !lower.includes('joinchat')
  ) {
    return null;
  }

  const phoneFromQuery = t.match(/[?&]phone=([^&#]+)/i)?.[1] ?? null;
  const phoneFromWaMe = t.match(/wa\.me\/([^/?#]+)/i)?.[1] ?? null;
  const phoneFromScheme = t.match(/^whatsapp:\s*(.+)$/i)?.[1] ?? null;
  const rawPhoneCandidate = phoneFromQuery ?? phoneFromWaMe ?? phoneFromScheme ?? '';
  let decodedPhoneCandidate = rawPhoneCandidate;
  try {
    decodedPhoneCandidate = decodeURIComponent(rawPhoneCandidate);
  } catch {
    decodedPhoneCandidate = rawPhoneCandidate;
  }
  const normalizedPhone = normalizeDialTarget(decodedPhoneCandidate);
  if (normalizedPhone) {
    return `whatsapp:${normalizedPhone}`;
  }

  const hostMatch = t.match(/^https?:\/\/([^/?#]+)/i);
  const host = (hostMatch?.[1] ?? '').toLowerCase();
  const pathMatch = t.match(/^https?:\/\/[^/?#]+\/([^?#]+)/i);
  const path = (pathMatch?.[1] ?? '').replace(/^\/+/, '');
  if (host === 'chat.whatsapp.com') {
    const inviteCode = path.split('/')[0] || 'unknown';
    return `whatsapp:joinchat/${inviteCode}`;
  }
  if ((host === 'api.whatsapp.com' || host === 'web.whatsapp.com') && path.toLowerCase().startsWith('joinchat')) {
    const inviteCode = path.replace(/^joinchat\/?/i, '') || 'unknown';
    return `whatsapp:joinchat/${inviteCode}`;
  }

  const canonicalUrl = t
    .replace(/^https?:\/\//i, '')
    .replace(/\?.*$/, '')
    .replace(/#.*$/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  return canonicalUrl ? `whatsapp:${canonicalUrl}` : 'whatsapp:unknown';
}

export function normalizePhoneTarget(raw: string): string {
  // Keep a stable normalized target for dedupe. Do not over-normalize WhatsApp URLs.
  const t = raw.trim();
  const whatsappTarget = canonicalizeWhatsAppTarget(t);
  if (whatsappTarget) return whatsappTarget;
  if (t.toLowerCase().startsWith('tel:')) {
    return normalizeDialTarget(t.slice(4)) ?? '';
  }
  // For plain numbers, normalize to digits/+ only.
  if (/^\+?\d[\d\s().-]{6,}$/.test(t)) {
    return normalizeDialTarget(t) ?? '';
  }
  return t;
}

export function inferIntentAction(phoneOrHref: string): 'phone' | 'whatsapp' {
  const normalizedTarget = normalizePhoneTarget(phoneOrHref).toLowerCase();
  const v = phoneOrHref.toLowerCase();
  if (normalizedTarget.startsWith('whatsapp:')) return 'whatsapp';
  if (v.includes('wa.me') || v.includes('whatsapp.com') || v.includes('chat.whatsapp.com') || v.includes('joinchat') || v.startsWith('whatsapp://')) return 'whatsapp';
  if (v.startsWith('tel:')) return 'phone';
  return 'phone';
}

function rand4(): string {
  return Math.random().toString(36).slice(2, 6).padEnd(4, '0');
}

function hash6(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  const out = Math.abs(h).toString(36);
  return out.slice(0, 6).padEnd(6, '0');
}

export function makeIntentStamp(actionShort: string, target: string): string {
  const ts = Date.now();
  const tHash = hash6((target || '').toLowerCase());
  return `${ts}-${rand4()}-${actionShort}-${tHash}`;
}

export function parseValueAllowNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

