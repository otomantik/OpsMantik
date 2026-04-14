import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { hasCapability } from '@/lib/auth/rbac';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { siteId } = await params;
    const access = await validateSiteAccess(siteId, user.id, supabase);
    
    // Allow owner or admin
    if (!access.allowed || (access.role !== 'owner' && access.role !== 'admin')) {
      return NextResponse.json({ error: 'Requires owner or admin role' }, { status: 403 });
    }

    const body = await req.json();
    const { base_deal_value_try, pipeline_stages } = body;

    // Fetch existing site to merge JSON
    const { data: site } = await adminClient.from('sites').select('oci_config, default_aov').eq('id', siteId).single();
    if (!site) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const updatedOciConfig = {
       ...(site.oci_config as Record<string, any> || {}),
       base_deal_value_try: base_deal_value_try
    };

    const { error } = await adminClient.from('sites').update({
       oci_config: updatedOciConfig,
       default_aov: base_deal_value_try, // Fallback legacy
       pipeline_stages,
    }).eq('id', siteId);

    if (error) {
       console.error('Config update failed:', error);
       return NextResponse.json({ error: 'Failed to save config' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
