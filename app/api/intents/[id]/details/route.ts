import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { validateSiteAccess } from '@/lib/security/validate-site-access';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: callId } = await params;
    const siteId = req.nextUrl.searchParams.get('siteId')?.trim() || '';

    if (!callId || !siteId) {
      return NextResponse.json({ error: 'Missing callId or siteId' }, { status: 400 });
    }

    const access = await validateSiteAccess(siteId, user.id, supabase);
    if (!access.allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data, error } = await adminClient.rpc('get_intent_details_v1', {
      p_site_id: siteId,
      p_call_id: callId,
    });

    if (error) {
      const message = String(error.message || error.details || '').toLowerCase();
      if (message.includes('access_denied')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      if (message.includes('not_authenticated')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      return NextResponse.json({ error: 'Failed to load intent details' }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ data }, { status: 200 });
  } catch {
    return NextResponse.json({ error: 'Failed to load intent details' }, { status: 500 });
  }
}
