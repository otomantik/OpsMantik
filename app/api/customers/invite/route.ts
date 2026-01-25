import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  try {
    // Validate current user is logged in (owner)
    const supabase = await createClient();
    const { data: { user: ownerUser } } = await supabase.auth.getUser();

    if (!ownerUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body = await req.json();
    const { email, site_id } = body;

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

    // Verify site belongs to current owner (security check)
    const { data: site, error: siteError } = await adminClient
      .from('sites')
      .select('id, user_id, name, domain')
      .eq('id', site_id)
      .eq('user_id', ownerUser.id) // Must belong to current owner
      .single();

    if (siteError || !site) {
      return NextResponse.json(
        { error: 'Site not found or access denied' },
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
          invited_by: ownerUser.id,
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

    // Transfer site ownership to customer (MINIMAL approach: update sites.user_id)
    const { error: updateError } = await adminClient
      .from('sites')
      .update({ user_id: customerUser.id })
      .eq('id', site_id);

    if (updateError) {
      console.error('[CUSTOMERS_INVITE] Error updating site:', updateError);
      return NextResponse.json(
        { error: 'Failed to assign site to customer', details: updateError.message },
        { status: 500 }
      );
    }

    // Generate magic link for customer login
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: 'magiclink',
      email: email,
      options: {
        redirectTo: `${siteUrl}/dashboard`,
      },
    });

    if (linkError || !linkData) {
      console.error('[CUSTOMERS_INVITE] Error generating link:', linkError);
      // Still return success - user can use password reset or email login
      return NextResponse.json({
        success: true,
        message: 'Customer invited successfully. Site ownership transferred.',
        customer_email: email,
        site_name: site.name,
        login_url: null, // Link generation failed, but invite succeeded
        note: 'Customer can log in via email/password or use password reset',
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Customer invited successfully. Site ownership transferred.',
      customer_email: email,
      site_name: site.name,
      login_url: linkData.properties.action_link,
      note: 'Share this login URL with the customer',
    });
  } catch (error: any) {
    console.error('[CUSTOMERS_INVITE] Exception:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
