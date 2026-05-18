import type { PreviousSessionContext, TrafficChannel } from '../truth-engine-types';
import type { ContradictionCode } from '../reason-codes';

export type ParsedParams = {
  gclid: string | null;
  wbraid: string | null;
  gbraid: string | null;
  srsltid: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  fbclid: string | null;
  ig_shid: string | null;
};

export type SanitizedClickIds = {
  gclid?: string;
  wbraid?: string;
  gbraid?: string;
};

export type VerdictDraft = {
  channel: TrafficChannel;
  is_paid: boolean;
  reason_code: string;
  identity_grade?: import('../truth-engine-types').IdentityGrade;
};

export type ClassificationContext = {
  url: string;
  referrer: string;
  userAgent: string;
  previousSession?: PreviousSessionContext;
  parsed: ParsedParams;
  sanitized: SanitizedClickIds;
  hasRawClickIdParam: boolean;
  referrerHost: string | null;
  decision_trace: string[];
  selected_evidence: string[];
  ignored_evidence: string[];
  contradiction_reasons: ContradictionCode[];
  contradiction_score: number;
  verdict: VerdictDraft | null;
  terminal: boolean;
  is_fraud_suspected: boolean;
  assist_channels: TrafficChannel[];
};

function normParam(v: string | null): string | null {
  if (!v) return null;
  const t = v.trim();
  return t.length ? t : null;
}

function safeUrl(u: string): URL | null {
  try {
    return new URL(u);
  } catch {
    try {
      return new URL(u, 'https://x.invalid');
    } catch {
      return null;
    }
  }
}

export function getReferrerHost(referrer: string): string | null {
  if (!referrer?.trim()) return null;
  try {
    return new URL(referrer).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function parseParamsFromUrl(url: string): ParsedParams {
  const parsed = safeUrl(url);
  const get = (k: string) => normParam(parsed?.searchParams.get(k) ?? null);
  return {
    gclid: get('gclid'),
    wbraid: get('wbraid'),
    gbraid: get('gbraid'),
    srsltid: get('srsltid'),
    utm_source: get('utm_source'),
    utm_medium: get('utm_medium'),
    utm_campaign: get('utm_campaign'),
    fbclid: get('fbclid'),
    ig_shid: get('ig_shid'),
  };
}

export function hasMeaningfulParams(parsed: ParsedParams): boolean {
  return Boolean(
    parsed.gclid ||
      parsed.wbraid ||
      parsed.gbraid ||
      parsed.srsltid ||
      parsed.utm_source ||
      parsed.utm_medium ||
      parsed.utm_campaign ||
      parsed.fbclid ||
      parsed.ig_shid
  );
}

export function isDirectShapedLanding(
  referrer: string,
  parsed: ParsedParams
): boolean {
  return !referrer?.trim() && !hasMeaningfulParams(parsed);
}

export function createClassificationContext(
  url: string,
  referrer: string,
  userAgent: string,
  previousSession?: PreviousSessionContext,
  sanitized: SanitizedClickIds = {}
): ClassificationContext {
  const parsed = parseParamsFromUrl(url);
  const hasRawClickIdParam = Boolean(parsed.gclid || parsed.wbraid || parsed.gbraid);
  return {
    url,
    referrer: referrer ?? '',
    userAgent: userAgent ?? '',
    previousSession,
    parsed,
    sanitized,
    hasRawClickIdParam,
    referrerHost: getReferrerHost(referrer ?? ''),
    decision_trace: [],
    selected_evidence: [],
    ignored_evidence: [],
    contradiction_reasons: [],
    contradiction_score: 0,
    verdict: null,
    terminal: false,
    is_fraud_suspected: false,
    assist_channels: [],
  };
}

export function setTerminalVerdict(ctx: ClassificationContext, verdict: VerdictDraft): void {
  ctx.verdict = verdict;
  ctx.terminal = true;
}
