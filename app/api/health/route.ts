/**
 * Watchtower GO W1 — Health endpoint.
 * GET /api/health → { ok: true, ts, git_sha?, db_ok? }
 * Lightweight DB check (SELECT 1) with timeout; never blocks.
 */
import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

const DB_CHECK_TIMEOUT_MS = 2000;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SIGNING_DISABLED =
  process.env.CALL_EVENT_SIGNING_DISABLED === '1' || process.env.CALL_EVENT_SIGNING_DISABLED === 'true';
const SIGNING_DISABLED_IN_PROD = SIGNING_DISABLED && process.env.NODE_ENV === 'production';
let sentSigningDisabledWarning = false;

export async function GET() {
  const ts = new Date().toISOString();
  const git_sha =
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    undefined;

  let db_ok: boolean | undefined;
  try {
    db_ok = await checkDbWithTimeout();
  } catch {
    db_ok = false;
  }

  if (SIGNING_DISABLED_IN_PROD && !sentSigningDisabledWarning) {
    sentSigningDisabledWarning = true;
    Sentry.captureMessage('CALL_EVENT_SIGNING_DISABLED enabled in production', {
      level: 'warning',
      tags: { route: '/api/health' },
    });
  }

  return NextResponse.json({
    ok: true,
    ts,
    ...(git_sha != null && { git_sha }),
    ...(db_ok !== undefined && { db_ok }),
    ...(SIGNING_DISABLED_IN_PROD && { signing_disabled: true }),
  });
}

async function checkDbWithTimeout(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return false;
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient(url, key, { auth: { persistSession: false } });
    const query = client.rpc('ping');
    const timeout = new Promise<{ error: Error }>((_, reject) =>
      setTimeout(() => reject(new Error('db_timeout')), DB_CHECK_TIMEOUT_MS)
    );
    const result = await Promise.race([query, timeout]);
    if (result && 'error' in result) return !result.error;
    return false;
  } catch {
    return false;
  }
}
