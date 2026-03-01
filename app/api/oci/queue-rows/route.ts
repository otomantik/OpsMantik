/**
 * GET /api/oci/queue-rows?siteId=...&limit=100&status=...&cursor=...
 * OCI Control: paginated rows for dashboard table.
 * Auth: session + validateSiteAccess.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { requireOciControlAuth } from '@/lib/oci/control-auth';
import {
  QueueRowsQuerySchema,
  type OciQueueRow,
  type QueueStatus,
  type ProviderErrorCategory,
} from '@/lib/domain/oci/queue-types';
import { PROVIDER_ERROR_CATEGORIES, QUEUE_STATUSES } from '@/lib/domain/oci/queue-types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_LIMIT = 200;

function parseCursor(cursor: string): number {
  const n = parseInt(cursor, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const parsed = QueueRowsQuerySchema.safeParse({
    siteId: searchParams.get('siteId') ?? '',
    limit: searchParams.get('limit') ?? 100,
    status: searchParams.get('status') ?? undefined,
    cursor: searchParams.get('cursor') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const auth = await requireOciControlAuth(parsed.data.siteId);
  if (auth instanceof NextResponse) return auth;
  const siteUuid = auth.siteUuid;

  const limit = Math.min(MAX_LIMIT, Math.max(1, parsed.data.limit));
  const statusFilter = parsed.data.status;
  const offset = parsed.data.cursor ? parseCursor(parsed.data.cursor) : 0;

  let query = adminClient
    .from('offline_conversion_queue')
    .select('id, call_id, status, provider_error_code, provider_error_category, last_error, attempt_count, created_at, updated_at')
    .eq('site_id', siteUuid);

  if (statusFilter && QUEUE_STATUSES.includes(statusFilter as QueueStatus)) {
    query = query.eq('status', statusFilter);
  }

  query = query
    .order('updated_at', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit - 1);

  const { data: rows, error } = await query;

  if (error) {
    return NextResponse.json(
      { error: 'Something went wrong', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }

  const list = Array.isArray(rows) ? rows : [];
  const nextCursor = list.length === limit ? String(offset + limit) : undefined;

  const out: OciQueueRow[] = list.map((r) => {
    const row = r as {
      id: string;
      call_id: string | null;
      status: string;
      provider_error_code: string | null;
      provider_error_category: string | null;
      last_error: string | null;
      attempt_count: number;
      created_at: string;
      updated_at: string;
    };
    return {
      id: row.id,
      call_id: row.call_id ?? null,
      status: (QUEUE_STATUSES.includes(row.status as QueueStatus) ? row.status : 'QUEUED') as QueueStatus,
      provider_error_code: row.provider_error_code ?? null,
      provider_error_category: PROVIDER_ERROR_CATEGORIES.includes(
        row.provider_error_category as ProviderErrorCategory
      )
        ? (row.provider_error_category as ProviderErrorCategory)
        : null,
      last_error: row.last_error ?? null,
      attempt_count: Number(row.attempt_count) || 0,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  });

  return NextResponse.json({
    siteId: siteUuid,
    rows: out,
    ...(nextCursor && { nextCursor }),
  });
}
