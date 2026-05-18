/**
 * Storage retention kernel — shared cron/route guards (STORAGE_RETENTION_KERNEL_AUDIT_FIRST).
 */

import type { NextRequest } from 'next/server';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';
import { logWarn } from '@/lib/logging/logger';

export const STORAGE_CLEANUP_APPROVAL_ENV = 'OPSMANTIK_STORAGE_CLEANUP_APPROVAL';
export const STORAGE_CLEANUP_APPROVAL_VALUE = 'I_APPROVE_STORAGE_MUTATION';

export type StorageCleanupParams = {
  dryRun: boolean;
  batchLimit: number;
  days?: number;
  recoveryJunk: boolean;
};

export function assertStorageCleanupApproval(): void {
  const v = process.env[STORAGE_CLEANUP_APPROVAL_ENV]?.trim();
  if (v !== STORAGE_CLEANUP_APPROVAL_VALUE) {
    throw new Error(
      `Storage cleanup mutation blocked: set ${STORAGE_CLEANUP_APPROVAL_ENV}=${STORAGE_CLEANUP_APPROVAL_VALUE}`
    );
  }
}

/**
 * Params for storage cleanup crons.
 * - ?dryRun=1 → always dry-run
 * - ?apply=true → mutate (requires approval env)
 * - default: mutate when OPSMANTIK_STORAGE_CLEANUP_APPROVAL is set (prod), else dry-run
 */
export function parseStorageCleanupParams(
  req: NextRequest,
  defaults?: { batchLimit?: number; days?: number }
): StorageCleanupParams {
  const dryRunParam = req.nextUrl.searchParams.get('dryRun');
  if (dryRunParam === '1' || dryRunParam === 'true') {
    return buildParams(req, true, defaults);
  }

  const apply =
    req.nextUrl.searchParams.get('apply') === 'true' ||
    req.nextUrl.searchParams.get('apply') === '1';
  if (apply) {
    assertStorageCleanupApproval();
    return buildParams(req, false, defaults);
  }

  const approved =
    process.env[STORAGE_CLEANUP_APPROVAL_ENV]?.trim() === STORAGE_CLEANUP_APPROVAL_VALUE;
  return buildParams(req, !approved, defaults);
}

function buildParams(
  req: NextRequest,
  dryRun: boolean,
  defaults?: { batchLimit?: number; days?: number }
): StorageCleanupParams {

  const batchLimitRaw = req.nextUrl.searchParams.get('limit');
  const batchLimit = parseInt(batchLimitRaw ?? String(defaults?.batchLimit ?? 5000), 10);
  const daysRaw = req.nextUrl.searchParams.get('days');
  const days = daysRaw != null ? parseInt(daysRaw, 10) : defaults?.days;

  const recoveryJunk =
    req.nextUrl.searchParams.get('recovery_junk') === 'true' ||
    req.nextUrl.searchParams.get('recoveryJunk') === 'true';

  return {
    dryRun,
    batchLimit: Number.isFinite(batchLimit) ? Math.min(Math.max(batchLimit, 1), 10000) : 5000,
    days: days != null && Number.isFinite(days) ? Math.min(Math.max(days, 1), 365) : defaults?.days,
    recoveryJunk,
  };
}

export type LimitHitAssessment = {
  limitHit: boolean;
  level: 'none' | 'info' | 'warning' | 'critical';
  message?: string;
};

/** Classify limit_hit_today / 1d+backlog / 3d consecutive (caller tracks consecutive via heartbeats). */
export function assessLimitHit(
  affected: number,
  batchLimit: number,
  opts?: { backlogAgeHigh?: boolean; consecutiveLimitDays?: number }
): LimitHitAssessment {
  if (affected < batchLimit) {
    return { limitHit: false, level: 'none' };
  }

  incrementRefactorMetric('storage_cleanup_limit_hit_total');

  const consecutive = opts?.consecutiveLimitDays ?? 0;
  if (consecutive >= 3) {
    return {
      limitHit: true,
      level: 'critical',
      message: 'limit_hit_3d: batch saturated 3+ days',
    };
  }
  if (consecutive >= 1 && opts?.backlogAgeHigh) {
    return {
      limitHit: true,
      level: 'warning',
      message: 'limit_hit_1d with backlog_age_high',
    };
  }

  return {
    limitHit: true,
    level: 'info',
    message: 'limit_hit_today',
  };
}

export function logLimitHitAssessment(jobName: string, assessment: LimitHitAssessment): void {
  if (!assessment.limitHit) return;
  logWarn('STORAGE_CLEANUP_LIMIT_HIT', {
    job_name: jobName,
    level: assessment.level,
    message: assessment.message,
  });
}

export type StorageCleanupRpcResult = {
  affected?: number;
  dry_run?: boolean;
  limit?: number;
  [key: string]: unknown;
};

export function parseRpcAffected(data: unknown): number {
  if (typeof data === 'number') return data;
  if (data && typeof data === 'object' && 'affected' in data) {
    const n = Number((data as StorageCleanupRpcResult).affected);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
