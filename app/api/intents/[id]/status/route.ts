/**
 * API Route: Update Intent Status
 * 
 * Updates the status of a call (intent) in the calls table.
 * 
 * POST /api/intents/[id]/status
 * Body: { status: 'confirmed' | 'qualified' | 'real' | 'junk' | 'suspicious' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { status } = body;
    const callId = params.id;

    // Validate status
    const validStatuses = ['confirmed', 'qualified', 'real', 'junk', 'suspicious', 'intent'];
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status' },
        { status: 400 }
      );
    }

    // Verify user has access to this call's site
    const { data: call, error: callError } = await adminClient
      .from('calls')
      .select('site_id, sites!inner(user_id)')
      .eq('id', callId)
      .single();

    if (callError || !call) {
      return NextResponse.json(
        { error: 'Call not found' },
        { status: 404 }
      );
    }

    // Check access: user must own the site or be admin
    const siteUserId = (call.sites as any)?.user_id;
    const { data: profile } = await adminClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    const isAdmin = profile?.role === 'admin';
    const isOwner = siteUserId === user.id;

    if (!isAdmin && !isOwner) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      );
    }

    // Update call status
    const updateData: any = {
      status: status || null,
    };

    // Set confirmed_at if status is confirmed/qualified/real
    if (['confirmed', 'qualified', 'real'].includes(status)) {
      updateData.confirmed_at = new Date().toISOString();
    } else {
      updateData.confirmed_at = null;
    }

    const { data: updatedCall, error: updateError } = await adminClient
      .from('calls')
      .update(updateData)
      .eq('id', callId)
      .select()
      .single();

    if (updateError) {
      console.error('[INTENT_STATUS] Update error:', updateError);
      return NextResponse.json(
        { error: 'Failed to update status' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      call: updatedCall,
    });
  } catch (error) {
    console.error('[INTENT_STATUS] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
