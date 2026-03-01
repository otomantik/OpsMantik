/**
 * OCI Control API auth: session + site access.
 * Returns 401/403 NextResponse or { siteUuid }.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import type { QueueStatus } from '@/lib/domain/oci/queue-types';
import { QUEUE_STATUSES } from '@/lib/domain/oci/queue-types';

export interface OciControlAuthResult {
  siteUuid: string;
}

export async function requireOciControlAuth(
  siteId: string
): Promise<NextResponse | OciControlAuthResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let siteUuid = siteId;
  const byId = await adminClient.from('sites').select('id').eq('id', siteId).maybeSingle();
  if (byId.data) {
    siteUuid = (byId.data as { id: string }).id;
  } else {
    const byPublic = await adminClient
      .from('sites')
      .select('id')
      .eq('public_id', siteId)
      .maybeSingle();
    if (byPublic.data) {
      siteUuid = (byPublic.data as { id: string }).id;
    }
  }

  const access = await validateSiteAccess(siteUuid, user.id, supabase);
  if (!access.allowed) {
    return NextResponse.json({ error: 'Forbidden', code: access.reason }, { status: 403 });
  }

  return { siteUuid };
}

export function parseStatus(s: unknown): QueueStatus | undefined {
  if (typeof s !== 'string') return undefined;
  return QUEUE_STATUSES.includes(s as QueueStatus) ? (s as QueueStatus) : undefined;
}
