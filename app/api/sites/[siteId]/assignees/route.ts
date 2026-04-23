import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { adminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

type AssigneeRow = {
  id: string;
  email: string | null;
  role: string;
  source: 'owner' | 'member';
};

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ siteId: string }> }
) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: getBuildInfoHeaders() });
  }

  const { siteId } = await context.params;
  if (!siteId) {
    return NextResponse.json({ error: 'siteId is required' }, { status: 400, headers: getBuildInfoHeaders() });
  }

  const access = await validateSiteAccess(siteId, user.id, supabase);
  if (!access.allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: getBuildInfoHeaders() });
  }

  const { data: site, error: siteError } = await adminClient
    .from('sites')
    .select('id, user_id')
    .eq('id', siteId)
    .single();

  if (siteError || !site) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404, headers: getBuildInfoHeaders() });
  }

  const { data: members, error: membersError } = await adminClient
    .from('site_memberships')
    .select('user_id, role')
    .eq('site_id', siteId);

  if (membersError) {
    return NextResponse.json({ error: membersError.message }, { status: 500, headers: getBuildInfoHeaders() });
  }

  const userIds = Array.from(new Set([site.user_id, ...(members ?? []).map((m) => m.user_id)]));
  const { data: emails } = await adminClient
    .from('user_emails')
    .select('id, email')
    .in('id', userIds);

  const emailById = new Map((emails ?? []).map((row) => [row.id as string, (row.email as string | null) ?? null]));

  const rows: AssigneeRow[] = [
    {
      id: site.user_id as string,
      email: emailById.get(site.user_id as string) ?? null,
      role: 'owner',
      source: 'owner',
    },
    ...((members ?? []).map((member) => ({
      id: member.user_id as string,
      email: emailById.get(member.user_id as string) ?? null,
      role: String(member.role ?? 'operator'),
      source: 'member' as const,
    }))),
  ];

  const deduped = Array.from(new Map(rows.map((row) => [row.id, row])).values());

  return NextResponse.json(
    { items: deduped },
    { status: 200, headers: getBuildInfoHeaders() }
  );
}
