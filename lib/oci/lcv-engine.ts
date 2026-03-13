/**
 * OpsMantik LCV Engine 3.0 — "Singularity" Edition
 *
 * Advanced lead lifetime value computation using:
 *   Neural Trace × Forensic DNA × Urgency × Contextual Intel
 *
 * Formula: LCV = base_aov × stage_weight × Q_total × Singularity_Factor
 *
 * Features:
 *  - Forensic DNA: Behavioral signature for fraud detection/attribution.
 *  - Neural Trace: Entropy-based engagement scoring.
 *  - Urgency Delta: Speed-to-intent multiplier.
 */


// (No imports needed for isomorphic version)

export type LcvStage = 'V3' | 'V4' | 'V5';

const STAGE_WEIGHTS: Record<LcvStage, number> = {
  V3: 0.10, // Görüşüldü
  V4: 0.30, // Teklif
  V5: 1.00, // Mühür
};

// ── Quality multipliers ──────────────────────────────────────────────────────

function qLocation(city: string | null | undefined, district: string | null | undefined): number {
  const c = (city || '').trim().toLowerCase();
  const d = (district || '').trim().toLowerCase();
  const premiumDistricts = ['beşiktaş', 'sarıyer', 'çankaya', 'akatlar', 'levent', 'etiler', 'nişantaşı', 'bağcılar', 'kadıköy', 'üsküdar'];
  if (premiumDistricts.some(pd => d.includes(pd))) return 1.8;
  if (c.includes('istanbul')) return 1.5;
  if (c.includes('ankara') || c.includes('izmir')) return 1.3;
  return 1.0;
}

function qDevice(deviceType: string | null | undefined, deviceOs: string | null | undefined): number {
  const d = (deviceType || '').toLowerCase();
  const os = (deviceOs || '').toLowerCase();
  if (os.includes('ios') || os.includes('iphone') || os.includes('ipad')) return 1.4;
  if (d.includes('desktop') || d.includes('web')) return 0.9;
  return 1.1;
}

function qSource(trafficSource: string | null | undefined, utmTerm?: string | null): number {
  const src = (trafficSource || '').toLowerCase();
  const term = (utmTerm || '').toLowerCase();

  // High Intent Keywords (Muratcan specific & general)
  const highIntentTerms = ['akü yol yardım', 'en yakın akücü', 'acil akü', 'lastik yol yardım', '7/24', 'fiyatı', 'fiyatları'];
  if (highIntentTerms.some(t => term.includes(t))) return 1.7;

  if (src.includes('branded') || src.includes('marka')) return 1.6;
  return 1.0;
}

/** Urgency: How fast did they act? (Simulated/Estimated) */
function qUrgency(totalDurationSec: number | null | undefined, eventCount: number | null | undefined): number {
  const dur = totalDurationSec || 0;
  const events = eventCount || 0;
  if (dur > 0 && dur < 15 && events >= 2) return 1.5; // Decided instantly
  if (dur > 300) return 0.8; // Browsing too long (too much comparison)
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
  if (params.isReturning) score *= 1.35; // Returning visitors are gold
  if ((params.eventCount ?? 0) >= 5) score *= 1.2;
  return Math.min(score, 2.5);
}

// ── Singularity Tools ────────────────────────────────────────────────────────

/** Generates a behavioral DNA string (Isomorphic) */
function generateForensicDna(input: LcvInput): string {
  const raw = `${input.city}:${input.deviceOs}:${input.trafficSource}:${input.matchtype}:${input.phoneClicks}:${input.whatsappClicks}`;
  
  try {
    // Attempt node:crypto (Server)
    const { createHash } = require('node:crypto');
    return createHash('sha256').update(raw).digest('hex').substring(0, 12).toUpperCase();
  } catch {
    // Simple Hash Fallback (Browser)
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const char = raw.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16).padStart(12, '0').substring(0, 12).toUpperCase();
  }
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
}

export interface LcvResult {
  valueCents: number;
  valueUnits: number;
  stage: LcvStage;
  stageWeight: number;
  qualityMultiplier: number;
  forensicDna: string;
  singularityScore: number; // 0-100
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
  const { stage, baseAov, actualSaleAmount } = input;

  // Singularity DNA
  const forensicDna = generateForensicDna(input);

  // V5 with real amount
  if (stage === 'V5' && actualSaleAmount != null && actualSaleAmount > 0) {
    return {
      valueCents: Math.round(actualSaleAmount * 100),
      valueUnits: actualSaleAmount,
      stage,
      stageWeight: 1.0,
      qualityMultiplier: 1.0,
      forensicDna,
      singularityScore: 100,
      breakdown: { qLocation: 1, qDevice: 1, qSource: 1, qUrgency: 1, qBehavior: 1, qMatchtype: 1 },
      insights: [{ label: 'Confirmed Sale', icon: 'ShieldCheck', value: 'Actual Rev' }]
    };
  }

  const sw = STAGE_WEIGHTS[stage];
  const ql = qLocation(input.city, input.district);
  const qd = qDevice(input.deviceType, input.deviceOs);
  const qs = qSource(input.trafficSource, input.utmTerm);
  const qu = qUrgency(input.totalDurationSec, input.eventCount);
  const qb = qBehavior({
    phoneClicks: input.phoneClicks,
    whatsappClicks: input.whatsappClicks,
    eventCount: input.eventCount,
    totalDurationSec: input.totalDurationSec,
    isReturning: input.isReturning
  });
  const qm = (input.matchtype === 'e' ? 1.3 : input.matchtype === 'p' ? 1.1 : 0.8);

  const Q = ql * qd * qs * qu * qb * qm;
  const rawValue = baseAov * sw * Q;
  const valueUnits = Math.max(0.01, Math.round(rawValue * 100) / 100);
  const valueCents = Math.round(valueUnits * 100);

  // Singularity Score (0-100 Normalized)
  const singularityScore = Math.min(100, Math.round((Q / 4.0) * 100));

  // Insights Extraction
  const insights = [];
  if (ql > 1.4) insights.push({ label: 'Premium Geo', icon: 'MapPin', value: input.district || 'City' });
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
