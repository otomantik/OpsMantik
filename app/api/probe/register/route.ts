/**
 * POST /api/probe/register — Register a Probe device (public key) for a site.
 * Auth: Bearer (Supabase) + validateSiteAccess. Body: { siteId, deviceId, publicKeyPem }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { SiteService } from '@/lib/services/site-service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const siteId = typeof body.siteId === 'string' ? body.siteId.trim() : '';
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
    const publicKeyPem = typeof body.publicKeyPem === 'string' ? body.publicKeyPem.trim() : '';

    if (!siteId || !deviceId || !publicKeyPem) {
      return NextResponse.json(
        { error: 'Missing siteId, deviceId, or publicKeyPem' },
        { status: 400 }
      );
    }
    if (!publicKeyPem.includes('-----BEGIN') || !publicKeyPem.includes('-----END')) {
      return NextResponse.json(
        { error: 'publicKeyPem must be PEM-encoded (BEGIN/END lines)' },
        { status: 400 }
      );
    }

    const { valid, site } = await SiteService.validateSite(siteId);
    if (!valid || !site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }
    const siteUuid = site.id;

    const access = await validateSiteAccess(siteUuid, user.id, supabase);
    if (!access.allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { error } = await adminClient.from('probe_devices').upsert(
      {
        site_id: siteUuid,
        device_id: deviceId,
        public_key_pem: publicKeyPem,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'site_id,device_id' }
    );

    if (error) {
      return NextResponse.json({ error: 'Registration failed' }, { status: 500 });
    }

    return NextResponse.json({ registered: true, siteId: siteUuid });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
