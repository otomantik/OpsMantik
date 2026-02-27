/**
 * POST /api/calls/[id]/stage — Process a dynamic funnel stage action (e.g., sealed, junk, photo_received).
 * Uses PipelineService to update the call and optionally enqueue for Google Ads OCI.
 *
 * Auth: Same as seal route — cookie session or Bearer token. Requires queue:operate capability.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { adminClient } from '@/lib/supabase/admin';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { hasCapability } from '@/lib/auth/rbac';
import { logInfo, logError } from '@/lib/logging/logger';
import * as Sentry from '@sentry/nextjs';
import { PipelineService } from '@/lib/services/pipeline-service';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = req.headers.get('x-request-id') ?? undefined;
  const route = '/api/calls/[id]/stage';

  try {
    const { id: callId } = await params;
    if (!callId) {
      return NextResponse.json({ error: 'Missing call id' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const stageId = typeof body.stageId === 'string' ? body.stageId.trim() : '';
    const customAmountCents =
      body.customAmountCents != null ? Number(body.customAmountCents) : undefined;
    const version = body.version != null ? Number(body.version) : undefined;

    if (!stageId) {
      return NextResponse.json({ error: 'Missing stageId' }, { status: 400 });
    }

    if (
      customAmountCents != null &&
      (Number.isNaN(customAmountCents) || customAmountCents < 0)
    ) {
      return NextResponse.json(
        { error: 'customAmountCents must be a non-negative number' },
        { status: 400 }
      );
    }

    // Auth: cookie or Bearer
    const authHeader = req.headers.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

    let userClient: SupabaseClient | undefined;
    let user: { id: string } | null = null;

    if (bearerToken) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !anonKey) {
        return NextResponse.json({ error: 'Server config missing' }, { status: 500 });
      }
      userClient = createClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${bearerToken}` } },
        auth: { persistSession: false },
      });
      const { data: sessionData } = await userClient.auth.setSession({
        access_token: bearerToken,
        refresh_token: '',
      });
      user = sessionData?.user ?? (await userClient.auth.getUser()).data.user ?? null;
    }

    if (!user) {
      userClient = await createServerClient();
      const { data: { user: u } } = await userClient.auth.getUser();
      user = u ?? null;
    }

    if (!user || !userClient) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logInfo('stage request', { request_id: requestId, route, user_id: user.id, call_id: callId, stage_id: stageId });

    // Lookup call and derive siteId from DB (never trust client)
    const { data: call, error: fetchError } = await adminClient
      .from('calls')
      .select('id, site_id')
      .eq('id', callId)
      .maybeSingle();

    if (fetchError || !call) {
      return NextResponse.json({ error: 'Call not found' }, { status: 404 });
    }

    const siteId = call.site_id;
    const access = await validateSiteAccess(siteId, user.id, userClient);
    if (!access.allowed) {
      return NextResponse.json({ error: 'Call not found or access denied' }, { status: 404 });
    }
    if (!access.role || !hasCapability(access.role, 'queue:operate')) {
      return NextResponse.json({ error: 'Call not found or access denied' }, { status: 404 });
    }

    const result = await PipelineService.processStageAction(
      siteId,
      callId,
      stageId,
      customAmountCents,
      version
    );

    if (!result.success && result.reason === 'version_mismatch') {
      return NextResponse.json(
        { error: 'Concurrency conflict: Call was updated by another user. Please refresh and try again.' },
        { status: 409 }
      );
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logError(message, { request_id: requestId, route });
    Sentry.captureException(err, { tags: { request_id: requestId, route } });
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
