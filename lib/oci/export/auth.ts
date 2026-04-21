import { timingSafeCompare } from '@/lib/security/timing-safe-compare';
import type { NextRequest } from 'next/server';

export function resolveAuthAttempt(req: NextRequest): { bearer: string; apiKey: string } {
  const bearer = (req.headers.get('authorization') || '').trim();
  const apiKey = (req.headers.get('x-api-key') || '').trim();
  return { bearer, apiKey };
}

export function verifySiteApiKey(siteKey: string | null | undefined, suppliedApiKey: string): boolean {
  if (!siteKey || !suppliedApiKey) return false;
  return timingSafeCompare(siteKey, suppliedApiKey);
}
