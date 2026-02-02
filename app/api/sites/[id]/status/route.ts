import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { isAdmin } from '@/lib/auth/isAdmin';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Validate current user is logged in
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: siteId } = await params;

    if (!siteId) {
      return NextResponse.json(
        { error: 'Site ID is required' },
        { status: 400 }
      );
    }

    // Check if user is admin
    const userIsAdmin = await isAdmin();

    // Verify site access: user must be owner OR member OR admin
    const { data: site, error: siteError } = await supabase
      .from('sites')
      .select('id, user_id')
      .eq('id', siteId)
      .single();

    if (siteError || !site) {
      return NextResponse.json(
        { error: 'Site not found or access denied' },
        { status: 403 }
      );
    }

    // If not admin, verify user has access (owner or member)
    if (!userIsAdmin && site.user_id !== user.id) {
      // Check if user is a member
      const { data: membership } = await supabase
        .from('site_members')
        .select('site_id')
        .eq('site_id', siteId)
        .eq('user_id', user.id)
        .single();

      if (!membership) {
        return NextResponse.json(
          { error: 'Site not found or access denied' },
          { status: 403 }
        );
      }
    }

    // Get current month for partition query
    const currentMonth = new Date().toISOString().slice(0, 7) + '-01';
    const currentMonthDate = new Date(currentMonth);

    // Get session IDs for this site (current month)
    const { data: sessions, error: sessionsError } = await adminClient
      .from('sessions')
      .select('id')
      .eq('site_id', siteId)
      .eq('created_month', currentMonth)
      .limit(100); // Get recent sessions

    if (sessionsError) {
      console.error('[SITES_STATUS] Error querying sessions:', sessionsError);
    }

    let lastEvent = null;
    if (sessions && sessions.length > 0) {
      const sessionIds = sessions.map(s => s.id);
      
      // Query last event for these sessions (current month partition)
      const { data: events, error: eventError } = await adminClient
        .from('events')
        .select('id, session_id, created_at, event_category, event_action, event_label')
        .in('session_id', sessionIds)
        .eq('session_month', currentMonth)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (eventError) {
        console.error('[SITES_STATUS] Error querying events:', eventError);
      } else {
        lastEvent = events;
      }
    }

    // Also check previous month partition if no events found in current month
    let lastEventPrevMonth = null;
    if (!lastEvent) {
      const prevMonth = new Date(currentMonthDate);
      prevMonth.setMonth(prevMonth.getMonth() - 1);
      const prevMonthStr = prevMonth.toISOString().slice(0, 7) + '-01';

      const { data: prevSessions } = await adminClient
        .from('sessions')
        .select('id')
        .eq('site_id', siteId)
        .eq('created_month', prevMonthStr)
        .limit(100);

      if (prevSessions && prevSessions.length > 0) {
        const prevSessionIds = prevSessions.map(s => s.id);
        
        const { data: prevEvents } = await adminClient
          .from('events')
          .select('id, session_id, created_at, event_category, event_action, event_label')
          .in('session_id', prevSessionIds)
          .eq('session_month', prevMonthStr)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        lastEventPrevMonth = prevEvents;
      }
    }

    // Use most recent event (current month or previous month)
    const mostRecentEvent = lastEvent || lastEventPrevMonth;

    // Get last session ID (for reference)
    const { data: lastSession } = await adminClient
      .from('sessions')
      .select('id, created_at')
      .eq('site_id', siteId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Determine status based on last_event_at recency
    let status = 'No traffic yet';
    let lastEventAt: string | null = null;
    let lastSessionId: string | null = null;
    let lastSource: string | null = null;

    if (mostRecentEvent) {
      lastEventAt = mostRecentEvent.created_at;
      lastSessionId = mostRecentEvent.session_id;
      
      // Extract source from event metadata if available
      if (mostRecentEvent.event_label) {
        lastSource = mostRecentEvent.event_label;
      } else if (mostRecentEvent.event_action) {
        lastSource = mostRecentEvent.event_action;
      }

      // Check if event is within last 10 minutes
      if (lastEventAt) {
        const eventTime = new Date(lastEventAt);
        const now = new Date();
        const minutesAgo = (now.getTime() - eventTime.getTime()) / (1000 * 60);

        if (minutesAgo <= 10) {
          status = 'Receiving events';
        } else {
          status = 'No traffic yet';
        }
      }
    } else if (lastSession) {
      // Has sessions but no events (unlikely but possible)
      status = 'No traffic yet';
      lastSessionId = lastSession.id;
    }

    return NextResponse.json({
      site_id: siteId,
      status,
      last_event_at: lastEventAt,
      last_session_id: lastSessionId,
      last_source: lastSource,
      last_event_category: mostRecentEvent?.event_category || null,
      last_event_action: mostRecentEvent?.event_action || null,
    });
  } catch (error: unknown) {
    console.error('[SITES_STATUS] Exception:', error);
    const details = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: 'Internal server error', details },
      { status: 500 }
    );
  }
}
