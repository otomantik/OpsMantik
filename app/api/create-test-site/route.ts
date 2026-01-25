import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user already has any site
    const { data: existingUserSite } = await adminClient
      .from('sites')
      .select('*')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (existingUserSite) {
      return NextResponse.json({
        success: true,
        site: existingUserSite,
        message: 'You already have a site',
      });
    }

    // Generate unique public_id for this user
    const publicId = `test_site_${user.id.slice(0, 8)}`;
    
    // Check if this public_id already exists (shouldn't happen, but just in case)
    const { data: existingSiteWithId } = await adminClient
      .from('sites')
      .select('*')
      .eq('public_id', publicId)
      .maybeSingle();

    if (existingSiteWithId) {
      // If somehow it exists, use a timestamp-based ID
      const timestampId = `test_site_${Date.now()}`;
      const { data: newSite, error: createError } = await adminClient
        .from('sites')
        .insert({
          user_id: user.id,
          public_id: timestampId,
          domain: 'localhost:3000',
        })
        .select()
        .single();

      if (createError) {
        console.error('[CREATE_TEST_SITE] Error:', createError);
        return NextResponse.json(
          { error: 'Failed to create test site', details: createError.message },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        site: newSite,
        message: 'Test site created successfully',
      });
    }

    // Create new test site with unique public_id
    const { data: newSite, error: createError } = await adminClient
      .from('sites')
      .insert({
        user_id: user.id,
        public_id: publicId,
        domain: 'localhost:3000',
      })
      .select()
      .single();

    if (createError) {
      console.error('[CREATE_TEST_SITE] Error:', createError);
      return NextResponse.json(
        { error: 'Failed to create test site', details: createError.message, code: createError.code },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      site: newSite,
      message: 'Test site created successfully',
    });
  } catch (error: any) {
    console.error('[CREATE_TEST_SITE] Exception:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
