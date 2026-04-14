import { createHash } from 'node:crypto';
import { normalizeTr, LcvIntelligenceConfig } from './oci-config';

export type LcvStage = 'V3' | 'V4' | 'V5';

/**
 * Default LCV stage weights.
 * V3 canonical value is 0.20 — matches SiteExportConfig.gear_weights.V3 default.
 * Was incorrectly 0.10; the 3-source inconsistency is now resolved.
 * Callers should pass config.gear_weights when available for per-site accuracy.
 */
const DEFAULT_LCV_STAGE_WEIGHTS: Record<LcvStage, number> = {
  V3: 20, // Görüşüldü (Score: 20/100)
  V4: 30, // Teklif (Score: 30/100)
  V5: 100, // Mühür (Score: 100/100)
};

// ── Quality multipliers ──────────────────────────────────────────────────────

function qLocation(
  city: string | null | undefined, 
  district: string | null | undefined,
  config?: LcvIntelligenceConfig
): number {
  const c = normalizeTr(city);
  const d = normalizeTr(district);
  
  const premiumDistricts = config?.premium_districts?.length 
    ? config.premium_districts.map(pd => normalizeTr(pd))
    : [
        'beşiktaş', 'sarıyer', 'çankaya', 'akatlar', 'levent', 'etiler', 'nişantaşı', 
        'bağcılar', 'kadıköy', 'üsküdar', 'esenyurt', 'beylikdüzü', 'başakşehir',
        'nilüfer', 'bornova', 'karşıyaka', 'muratpaşa', 'selçuklu'
      ];

  if (premiumDistricts.some(pd => d.includes(pd) || c.includes(pd))) return 1.8;
  if (c.includes('istanbul')) return 1.5;
  if (c.includes('ankara') || c.includes('izmir')) return 1.3;
  return 1.0;
}

function qDevice(
  deviceType: string | null | undefined, 
  deviceOs: string | null | undefined,
  config?: LcvIntelligenceConfig
): number {
  const d = normalizeTr(deviceType);
  const os = normalizeTr(deviceOs);
  
  // Dynamic Multiplier Lookup
  if (config?.multipliers) {
    if (os.includes('ios') && config.multipliers.ios) return config.multipliers.ios;
    if (d.includes('desktop') && config.multipliers.desktop) return config.multipliers.desktop;
  }

  if (os.includes('ios')) return 1.4;
  if (d.includes('desktop')) return 0.9;
  return 1.1;
}

function qSource(
  trafficSource: string | null | undefined, 
  utmTerm: string | null | undefined,
  config?: LcvIntelligenceConfig
): number {
  const src = normalizeTr(trafficSource);
  const term = normalizeTr(utmTerm);

  const highIntentTerms = config?.high_intent_keywords?.length
    ? config.high_intent_keywords.map(k => normalizeTr(k))
    : ['akü yol yardım', 'en yakın akücü', 'acil akü', 'lastik yol yardım', '7/24', 'fiyatı', 'fiyatları'];

  if (highIntentTerms.some(t => term.includes(t))) return 1.7;
  if (src.includes('branded') || src.includes('marka')) return 1.6;
  return 1.0;
}

/** Urgency: How fast did they act? (Simulated/Estimated) */
function qUrgency(totalDurationSec: number | null | undefined, eventCount: number | null | undefined): number {
  const dur = totalDurationSec || 0;
  const events = eventCount || 0;
  if (dur > 0 && dur < 15 && events >= 2) return 1.5; // Decided instantly
  if (dur > 300) return 0.8; // Browsing too long
  return 1.0;
}

function qBehavior(params: {
  phoneClicks?: number | null;
  whatsappClicks?: number | null;
  eventCount?: number | null;
  totalDurationSec?: number | null;
  isReturning?: boolean | null;
}): number {
  let score = 1.0;
  if ((params.whatsappClicks ?? 0) > 0) score *= 1.4;
  if ((params.phoneClicks ?? 0) > 0) score *= 1.25;
  if (params.isReturning) score *= 1.35;
  if ((params.eventCount ?? 0) >= 5) score *= 1.2;
  return Math.min(score, 2.5);
}

// ── Singularity Tools ────────────────────────────────────────────────────────

function generateForensicDna(input: LcvInput): string {
  const raw = `${input.city}:${input.deviceOs}:${input.trafficSource}:${input.matchtype}:${input.phoneClicks}:${input.whatsappClicks}`;
  
  return createHash('sha256').update(raw).digest('hex').substring(0, 12).toUpperCase();
}

// ── Main export ──────────────────────────────────────────────────────────────

export interface LcvInput {
  stage: LcvStage;
  baseAov: number;
  city?: string | null;
  district?: string | null;
  deviceType?: string | null;
  deviceOs?: string | null;
  trafficSource?: string | null;
  trafficMedium?: string | null;
  attributionSource?: string | null;
  matchtype?: string | null;
  utmTerm?: string | null;
  phoneClicks?: number | null;
  whatsappClicks?: number | null;
  eventCount?: number | null;
  totalDurationSec?: number | null;
  isReturning?: boolean | null;
  actualSaleAmount?: number | null;
  nowUtc?: Date;
  config?: LcvIntelligenceConfig;
  /**
   * Per-site gear weights from SiteExportConfig.
   * When provided, overrides DEFAULT_LCV_STAGE_WEIGHTS for V3/V4.
   * Ensures dashboard value display matches export value calculation.
   */
  gearWeights?: { V2?: number; V3?: number; V4?: number } | null;
}

export interface LcvResult {
  valueCents: number;
  valueUnits: number;
  stage: LcvStage;
  stageWeight: number;
  qualityMultiplier: number;
  forensicDna: string;
  singularityScore: number;
  breakdown: {
    qLocation: number;
    qDevice: number;
    qSource: number;
    qUrgency: number;
    qBehavior: number;
    qMatchtype: number;
  };
  insights: { label: string; icon: string; value: string }[];
}

export function computeLcv(input: LcvInput): LcvResult {
  const { stage, baseAov, actualSaleAmount, config, gearWeights } = input;
  const forensicDna = generateForensicDna(input);

  if (stage === 'V5' && actualSaleAmount != null && actualSaleAmount > 0) {
    return {
      valueCents: Math.round(actualSaleAmount * 100),
      valueUnits: actualSaleAmount,
      stage,
      stageWeight: 100,
      qualityMultiplier: 1.0,
      forensicDna,
      singularityScore: 100,
      breakdown: { qLocation: 1, qDevice: 1, qSource: 1, qUrgency: 1, qBehavior: 1, qMatchtype: 1 },
      insights: [{ label: 'Confirmed Sale', icon: 'ShieldCheck', value: 'Actual Rev' }]
    };
  }

  // Resolve stage weight: use per-site gearWeights (1-100) if provided, fall back to defaults.
  const resolvedStageWeights: Record<LcvStage, number> = {
    V3: gearWeights?.V3 ?? DEFAULT_LCV_STAGE_WEIGHTS.V3,
    V4: gearWeights?.V4 ?? DEFAULT_LCV_STAGE_WEIGHTS.V4,
    V5: DEFAULT_LCV_STAGE_WEIGHTS.V5,
  };
  
  const score = resolvedStageWeights[stage];
  const sw = score / 100;

  const ql = qLocation(input.city, input.district, config);
  const qd = qDevice(input.deviceType, input.deviceOs, config);
  const qs = qSource(input.trafficSource, input.utmTerm, config);
  const qu = qUrgency(input.totalDurationSec, input.eventCount);
  const qb = qBehavior({
    phoneClicks: input.phoneClicks,
    whatsappClicks: input.whatsappClicks,
    eventCount: input.eventCount,
    totalDurationSec: input.totalDurationSec,
    isReturning: input.isReturning
  });
  const qm = (input.matchtype === 'e' ? 1.3 : input.matchtype === 'p' ? 1.1 : 0.8);

  const Q = Math.min(ql * qd * qs * qu * qb * qm, 4.0);
  const rawValue = baseAov * sw * Q;
  const valueUnits = Math.max(0.01, Math.round(rawValue * 100) / 100);
  const valueCents = Math.round(valueUnits * 100);

  const singularityScore = Math.min(100, Math.round((Q / 4.0) * score));

  const insights = [];
  if (ql > 1.4) insights.push({ label: 'Premium Geo', icon: 'MapPin', value: (input.district || input.city || 'Konum').toUpperCase() });
  if (qd > 1.2) insights.push({ label: 'iOS Power User', icon: 'Smartphone', value: 'High Intent' });
  if (qs > 1.5) insights.push({ label: 'Express Keyword', icon: 'Zap', value: input.utmTerm?.substring(0, 10) || 'Match' });
  if (qu > 1.2) insights.push({ label: 'Blitz Intent', icon: 'Timer', value: 'Fast Action' });
  if (input.isReturning) insights.push({ label: 'Loyal Visitor', icon: 'UserCheck', value: 'Returning' });
  if (qb > 1.5) insights.push({ label: 'Deep Engagement', icon: 'TrendingUp', value: 'Converted' });

  return {
    valueCents,
    valueUnits,
    stage,
    stageWeight: sw,
    qualityMultiplier: Q,
    forensicDna,
    singularityScore,
    breakdown: { qLocation: ql, qDevice: qd, qSource: qs, qUrgency: qu, qBehavior: qb, qMatchtype: qm },
    insights
  };
}
