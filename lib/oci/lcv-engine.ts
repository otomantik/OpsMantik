import { createHash } from 'node:crypto';
import {
  buildOptimizationSnapshot,
  resolveOptimizationStage,
  type OptimizationStage,
} from './optimization-contract';
import type { PipelineStage } from '@/lib/domain/mizan-mantik/types';

export interface LcvInput {
  stage: PipelineStage;
  baseAov?: number;
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
  stage: PipelineStage;
  stageWeight: number;
  qualityMultiplier: number;
  forensicDna: string;
  singularityScore: number;
  breakdown: {
    systemScore: number;
    stageBase: number;
    qualityFactor: number;
  };
  insights: { label: string; icon: string; value: string }[];
}

export function resolveOptimizationValue(input: {
  stage: OptimizationStage;
  systemScore: number | null | undefined;
  actualRevenue?: number | null;
}) {
  return buildOptimizationSnapshot({
    stage: input.stage,
    systemScore: input.systemScore,
    actualRevenue: input.actualRevenue,
  });
}

export function computeLcv(input: LcvInput): LcvResult {
  if (input.stage === 'junk') {
     throw new Error('Junk stages should not be evaluated for LCV');
  }

  const systemScore = deriveSystemScore(input);
  const optimizationStage = resolveOptimizationStage({
    actionType: input.stage as OptimizationStage,
    leadScore: systemScore,
  });
  const snapshot = buildOptimizationSnapshot({
    stage: optimizationStage,
    systemScore,
    actualRevenue: input.actualSaleAmount ?? null,
  });
  const forensicDna = createHash('sha256')
    .update(
      JSON.stringify({
        stage: input.stage,
        city: input.city ?? null,
        district: input.district ?? null,
        deviceOs: input.deviceOs ?? null,
        trafficSource: input.trafficSource ?? null,
        utmTerm: input.utmTerm ?? null,
        phoneClicks: input.phoneClicks ?? 0,
        whatsappClicks: input.whatsappClicks ?? 0,
        isReturning: input.isReturning ?? false,
      })
    )
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();

  return {
    valueCents: Math.round(snapshot.optimizationValue * 100),
    valueUnits: snapshot.optimizationValue,
    stage: input.stage,
    stageWeight: snapshot.stageBase,
    qualityMultiplier: snapshot.qualityFactor,
    forensicDna,
    singularityScore: snapshot.systemScore,
    breakdown: {
      systemScore: snapshot.systemScore,
      stageBase: snapshot.stageBase,
      qualityFactor: snapshot.qualityFactor,
    },
    insights: buildInsights(input, snapshot.systemScore),
  };
}

function deriveSystemScore(input: LcvInput): number {
  let score = 50;

  if ((input.whatsappClicks ?? 0) > 0) score += 12;
  if ((input.phoneClicks ?? 0) > 0) score += 10;
  if (input.isReturning) score += 12;
  if ((input.eventCount ?? 0) >= 5) score += 8;
  if ((input.totalDurationSec ?? 0) > 0 && (input.totalDurationSec ?? 0) <= 30) score += 6;

  const district = `${input.city ?? ''} ${input.district ?? ''}`.toLowerCase();
  if (district.includes('istanbul') || district.includes('beşiktaş') || district.includes('besiktas')) score += 6;

  const source = `${input.trafficSource ?? ''} ${input.utmTerm ?? ''}`.toLowerCase();
  if (source.includes('brand') || source.includes('marka')) score += 8;
  if (source.includes('fiyat') || source.includes('acil') || source.includes('teklif')) score += 8;

  const deviceOs = (input.deviceOs ?? '').toLowerCase();
  if (deviceOs.includes('ios')) score += 4;

  if (input.stage === 'offered') score += 10;
  if (input.stage === 'won') score = 100;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildInsights(input: LcvInput, systemScore: number): { label: string; icon: string; value: string }[] {
  const insights: { label: string; icon: string; value: string }[] = [];
  if ((input.whatsappClicks ?? 0) > 0) insights.push({ label: 'WhatsApp', icon: 'MessageCircle', value: 'Engaged' });
  if ((input.phoneClicks ?? 0) > 0) insights.push({ label: 'Phone', icon: 'Phone', value: 'Clicked' });
  if (input.isReturning) insights.push({ label: 'Returning', icon: 'UserCheck', value: 'Known visitor' });
  if ((input.utmTerm ?? '').trim()) insights.push({ label: 'Keyword', icon: 'Search', value: String(input.utmTerm).slice(0, 24) });
  insights.push({ label: 'System Score', icon: 'Brain', value: String(systemScore) });
  return insights;
}
