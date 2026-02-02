import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { isAdmin } from '@/lib/auth/isAdmin';

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
    const { email, site_id, role = 'viewer' } = body;

    // Validate required fields
    if (!email || !site_id) {
      return NextResponse.json(
        { error: 'Email and site_id are required' },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    // Validate role
    const validRoles = ['viewer', 'editor', 'owner'];
    if (!validRoles.includes(role)) {
      return NextResponse.json(
        { error: `Invalid role. Must be one of: ${validRoles.join(', ')}` },
        { status: 400 }
      );
    }

    // Check if user is admin
    const userIsAdmin = await isAdmin();

    // Verify site access: user must be site owner OR admin
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

    // If not admin, verify user owns the site
    if (!userIsAdmin && site.user_id !== currentUser.id) {
      return NextResponse.json(
        { error: 'You must be the site owner or an admin to invite customers' },
        { status: 403 }
      );
    }

    // Check if user already exists
    const { data: existingUsers } = await adminClient.auth.admin.listUsers();
    let customerUser = existingUsers?.users.find(u => u.email === email);

    if (!customerUser) {
      // Create new user via Admin API
      const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
        email: email,
        email_confirm: true, // Auto-confirm email
        user_metadata: {
          invited_by: currentUser.id,
          invited_at: new Date().toISOString(),
        },
      });

      if (createError || !newUser.user) {
        console.error('[CUSTOMERS_INVITE] Error creating user:', createError);
        return NextResponse.json(
          { error: 'Failed to create user', details: createError?.message },
          { status: 500 }
        );
      }

      customerUser = newUser.user;
    }

    // Check if membership already exists
    const { data: existingMembership } = await adminClient
      .from('site_members')
      .select('id, role')
      .eq('site_id', site_id)
      .eq('user_id', customerUser.id)
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
          return NextResponse.json(
            { error: 'Failed to update membership', details: updateError.message },
            { status: 500 }
          );
        }
      }

      // Return success - membership already exists
      const { data: linkData } = await adminClient.auth.admin.generateLink({
        type: 'magiclink',
        email: email,
        options: {
          redirectTo: `${process.env.NEXT_PUBLIC_PRIMARY_DOMAIN ? `https://console.${process.env.NEXT_PUBLIC_PRIMARY_DOMAIN}` : 'http://localhost:3000'}/dashboard`,
        },
      });

      return NextResponse.json({
        success: true,
        message: `Customer already has access. Membership updated to ${role}.`,
        customer_email: email,
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
        user_id: customerUser.id,
        role: role,
      })
      .select()
      .single();

    if (insertError || !membership) {
      console.error('[CUSTOMERS_INVITE] Error creating membership:', insertError);
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
      email: email,
      options: {
        redirectTo: redirectUrl,
      },
    });

    if (linkError || !linkData) {
      console.error('[CUSTOMERS_INVITE] Error generating link:', linkError);
      // Still return success - user can use password reset or email login
      return NextResponse.json({
        success: true,
        message: `Customer invited successfully with ${role} role.`,
        customer_email: email,
        site_name: site.name,
        login_url: null, // Link generation failed, but invite succeeded
        role: role,
        note: 'Customer can log in via email/password or use password reset',
      });
    }

    return NextResponse.json({
      success: true,
      message: `Customer invited successfully with ${role} role.`,
      customer_email: email,
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
