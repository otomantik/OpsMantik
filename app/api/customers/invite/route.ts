import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { isAdmin } from '@/lib/auth/is-admin';
import { RateLimitService } from '@/lib/services/rate-limit-service';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { hasCapability } from '@/lib/auth/rbac';

async function findUserIdByEmailLc(emailLc: string): Promise<string | null> {
  const { data, error } = await adminClient
    .from('user_emails')
    .select('id')
    .eq('email_lc', emailLc)
    .maybeSingle();
  if (error || !data?.id) return null;
  return String(data.id);
}

async function auditInvite(params: {
  inviterUserId: string;
  siteId: string;
  inviteeEmail: string;
  inviteeEmailLc: string;
  role: string;
  outcome: string;
  details?: string | null;
}) {
  try {
    await adminClient.from('customer_invite_audit').insert({
      inviter_user_id: params.inviterUserId,
      site_id: params.siteId,
      invitee_email: params.inviteeEmail,
      invitee_email_lc: params.inviteeEmailLc,
      role: params.role,
      outcome: params.outcome,
      details: params.details ?? null,
    });
  } catch (e) {
    // Best-effort only; never fail invite because audit insert failed.
    console.warn('[CUSTOMERS_INVITE][AUDIT_FAIL]', e instanceof Error ? e.message : String(e));
  }
}

export async function POST(req: NextRequest) {
  try {
    // Validate current user is logged in
    const supabase = await createClient();
    const { data: { user: currentUser } } = await supabase.auth.getUser();

    if (!currentUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body = await req.json();
    const { email, site_id, role = 'analyst' } = body;
    const emailNorm = typeof email === 'string' ? email.trim() : '';
    const emailLc = emailNorm.toLowerCase();

    // Validate required fields
    if (!emailNorm || !site_id) {
      return NextResponse.json(
        { error: 'Email and site_id are required' },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailNorm)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    // Validate role
    const validRoles = ['admin', 'operator', 'analyst', 'billing'];
    if (!validRoles.includes(role)) {
      return NextResponse.json(
        { error: `Invalid role. Must be one of: ${validRoles.join(', ')}` },
        { status: 400 }
      );
    }

    // Check if user is admin
    const userIsAdmin = await isAdmin();

    // Verify site access: user must be site owner OR site admin OR platform admin
    const { data: site, error: siteError } = await supabase
      .from('sites')
      .select('id, user_id, name, domain')
      .eq('id', site_id)
      .single();

    if (siteError || !site) {
      return NextResponse.json(
        { error: 'Site not found or access denied' },
        { status: 403 }
      );
    }

    const access = await validateSiteAccess(site_id, currentUser.id, supabase);
    const canManageMembers = access.allowed && access.role && hasCapability(access.role, 'members:manage');

    // If not platform admin, require owner/site-admin capability
    if (!userIsAdmin && !canManageMembers) {
      return NextResponse.json(
        { error: 'You must be the site owner or an admin to invite customers' },
        { status: 403 }
      );
    }

    // Rate limit (distributed via Upstash):
    // - Per inviter+site: 20 invites / hour
    // - Per IP: 60 invites / hour (backstop)
    const perActorKey = `invite:${currentUser.id}:${site_id}`;
    const perActor = await RateLimitService.check(perActorKey, 20, 60 * 60 * 1000);
    if (!perActor.allowed) {
      const retryAfter = Math.ceil((perActor.resetAt - Date.now()) / 1000);
      await auditInvite({
        inviterUserId: currentUser.id,
        siteId: site_id,
        inviteeEmail: emailNorm,
        inviteeEmailLc: emailLc,
        role,
        outcome: 'rate_limited_actor',
        details: `retryAfterSec=${retryAfter}`,
      });
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfter },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      );
    }
    const ipKey = `invite_ip:${RateLimitService.getClientId(req)}`;
    const perIp = await RateLimitService.check(ipKey, 60, 60 * 60 * 1000);
    if (!perIp.allowed) {
      const retryAfter = Math.ceil((perIp.resetAt - Date.now()) / 1000);
      await auditInvite({
        inviterUserId: currentUser.id,
        siteId: site_id,
        inviteeEmail: emailNorm,
        inviteeEmailLc: emailLc,
        role,
        outcome: 'rate_limited_ip',
        details: `retryAfterSec=${retryAfter}`,
      });
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfter },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      );
    }

    // Find user id via indexed mapping (scales; avoids listUsers pagination issues).
    // Requires migration: 20260205130000_user_email_index.sql
    let customerUserId = await findUserIdByEmailLc(emailLc);

    if (!customerUserId) {
      // Create new user via Admin API (idempotent-ish: if already exists, we fall back).
      const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
        email: emailNorm,
        email_confirm: true, // Auto-confirm email
        user_metadata: {
          invited_by: currentUser.id,
          invited_at: new Date().toISOString(),
        },
      });

      if (createError || !newUser.user) {
        // If user already exists, createUser may error; retry lookup.
        customerUserId = await findUserIdByEmailLc(emailLc);
        if (!customerUserId) {
          console.error('[CUSTOMERS_INVITE] Error creating user:', createError);
          await auditInvite({
            inviterUserId: currentUser.id,
            siteId: site_id,
            inviteeEmail: emailNorm,
            inviteeEmailLc: emailLc,
            role,
            outcome: 'create_or_find_user_failed',
            details: createError?.message ?? null,
          });
          return NextResponse.json(
            { error: 'Failed to create/find user', details: createError?.message },
            { status: 500 }
          );
        }
      } else {
        customerUserId = newUser.user.id;
        // Best-effort: ensure mapping row exists even if trigger isn't active yet.
        void adminClient
          .from('user_emails')
          .upsert({ id: customerUserId, email: emailNorm, email_lc: emailLc }, { onConflict: 'id' });
      }
    }

    // Check if membership already exists
    const { data: existingMembership } = await adminClient
      .from('site_members')
      .select('id, role')
      .eq('site_id', site_id)
      .eq('user_id', customerUserId)
      .maybeSingle();

    if (existingMembership) {
      // Update existing membership role if different
      if (existingMembership.role !== role) {
        const { error: updateError } = await adminClient
          .from('site_members')
          .update({ role })
          .eq('id', existingMembership.id);

        if (updateError) {
          console.error('[CUSTOMERS_INVITE] Error updating membership:', updateError);
          await auditInvite({
            inviterUserId: currentUser.id,
            siteId: site_id,
            inviteeEmail: emailNorm,
            inviteeEmailLc: emailLc,
            role,
            outcome: 'membership_update_failed',
            details: updateError.message,
          });
          return NextResponse.json(
            { error: 'Failed to update membership', details: updateError.message },
            { status: 500 }
          );
        }
      }

      // Return success - membership already exists
      const { data: linkData } = await adminClient.auth.admin.generateLink({
        type: 'magiclink',
        email: emailNorm,
        options: {
          redirectTo: `${process.env.NEXT_PUBLIC_PRIMARY_DOMAIN ? `https://console.${process.env.NEXT_PUBLIC_PRIMARY_DOMAIN}` : 'http://localhost:3000'}/dashboard`,
        },
      });

      return NextResponse.json({
        success: true,
        message: `Customer already has access. Membership updated to ${role}.`,
        customer_email: emailNorm,
        site_name: site.name,
        login_url: linkData?.properties?.action_link || null,
        role: role,
      });
    }

    // Insert into site_members table
    const { data: membership, error: insertError } = await adminClient
      .from('site_members')
      .insert({
        site_id: site_id,
        user_id: customerUserId,
        role: role,
      })
      .select()
      .single();

    if (insertError || !membership) {
      console.error('[CUSTOMERS_INVITE] Error creating membership:', insertError);
      await auditInvite({
        inviterUserId: currentUser.id,
        siteId: site_id,
        inviteeEmail: emailNorm,
        inviteeEmailLc: emailLc,
        role,
        outcome: 'membership_create_failed',
        details: insertError?.message ?? null,
      });
      return NextResponse.json(
        { error: 'Failed to create membership', details: insertError?.message },
        { status: 500 }
      );
    }

    // Generate magic link for customer login
    const redirectUrl = process.env.NEXT_PUBLIC_PRIMARY_DOMAIN
      ? `https://console.${process.env.NEXT_PUBLIC_PRIMARY_DOMAIN}/dashboard`
      : 'http://localhost:3000/dashboard';

    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: 'magiclink',
      email: emailNorm,
      options: {
        redirectTo: redirectUrl,
      },
    });

    if (linkError || !linkData) {
      console.error('[CUSTOMERS_INVITE] Error generating link:', linkError);
      await auditInvite({
        inviterUserId: currentUser.id,
        siteId: site_id,
        inviteeEmail: emailNorm,
        inviteeEmailLc: emailLc,
        role,
        outcome: 'invite_ok_link_failed',
        details: linkError?.message ?? null,
      });
      // Still return success - user can use password reset or email login
      return NextResponse.json({
        success: true,
        message: `Customer invited successfully with ${role} role.`,
        customer_email: emailNorm,
        site_name: site.name,
        login_url: null, // Link generation failed, but invite succeeded
        role: role,
        note: 'Customer can log in via email/password or use password reset',
      });
    }

    await auditInvite({
      inviterUserId: currentUser.id,
      siteId: site_id,
      inviteeEmail: emailNorm,
      inviteeEmailLc: emailLc,
      role,
      outcome: existingMembership ? 'membership_updated' : 'membership_created',
      details: null,
    });

    return NextResponse.json({
      success: true,
      message: `Customer invited successfully with ${role} role.`,
      customer_email: emailNorm,
      site_name: site.name,
      login_url: linkData.properties.action_link,
      role: role,
      note: 'Share this login URL with the customer',
    });
  } catch (error: unknown) {
    console.error('[CUSTOMERS_INVITE] Exception:', error);
    const details = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: 'Internal server error', details },
      { status: 500 }
    );
  }
}
