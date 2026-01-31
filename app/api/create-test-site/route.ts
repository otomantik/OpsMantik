import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Check if user already has any site (RLS enforces user_id check)
    const { data: existingUserSite } = await supabase
      .from('sites')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (existingUserSite) {
      return NextResponse.json({
        success: true,
        site: existingUserSite,
        message: 'You already have a site',
      });
    }

    // 2. Generate unique public_id
    const basePublicId = `test_site_${user.id.slice(0, 8)}`;
    let publicId = basePublicId;
    let attempt = 0;

    // Retry logic for unique constraint satisfaction
    while (attempt < 3) {
      if (attempt > 0) {
        publicId = `${basePublicId}_${Date.now()}`;
      }

      const { data: newSite, error } = await supabase
        .from('sites')
        .insert({
          user_id: user.id, // RLS requires this to match auth.uid()
          public_id: publicId,
          domain: 'localhost:3000',
        })
        .select()
        .single();

      if (error) {
        // Unique violation (likely public_id collision)
        if (error.code === '23505') {
          console.warn('[CREATE_TEST_SITE] Collision for public_id:', publicId, 'Retrying...');
          attempt++;
          continue;
        }

        console.error('[CREATE_TEST_SITE] Error:', error);
        return NextResponse.json(
          { error: 'Failed to create test site', details: error.message, code: error.code },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        site: newSite,
        message: 'Test site created successfully',
      });
    }

    return NextResponse.json(
      { error: 'Failed to generate unique site ID after retries' },
      { status: 500 }
    );

  } catch (error: any) {
    console.error('[CREATE_TEST_SITE] Exception:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
