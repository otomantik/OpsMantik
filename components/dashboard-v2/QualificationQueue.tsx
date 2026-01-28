'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import { IntentQualificationCard, type IntentForQualification } from './IntentQualificationCard';
import { LazySessionDrawer } from '@/components/dashboard/lazy-session-drawer';
import { createClient } from '@/lib/supabase/client';
import { useRealtimeDashboard } from '@/lib/hooks/use-realtime-dashboard';

interface QualificationQueueProps {
  siteId: string;
}

export function QualificationQueue({ siteId }: QualificationQueueProps) {
  const [intents, setIntents] = useState<IntentForQualification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIntent, setSelectedIntent] = useState<IntentForQualification | null>(null);

  const fetchUnscoredIntents = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const supabase = createClient();

      // Fetch unscored intents: lead_score = 0 AND status = 'intent'
      // Order by created_at DESC (most recent first)
      const { data, error: fetchError } = await supabase
        .from('calls')
        .select('id, created_at, intent_action, intent_target, intent_page_url, matched_session_id, lead_score, status, click_id, gclid, wbraid, gbraid')
        .eq('site_id', siteId)
        .eq('status', 'intent')
        .eq('lead_score', 0)
        .order('created_at', { ascending: false })
        .limit(20); // Show first 20 unscored intents

      if (fetchError) {
        throw fetchError;
      }

      setIntents((data || []) as IntentForQualification[]);
    } catch (err: any) {
      setError(err?.message || 'Failed to load intents');
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  // Initial fetch
  useEffect(() => {
    fetchUnscoredIntents();
  }, [fetchUnscoredIntents]);

  // Realtime updates: refetch when new intents arrive
  useRealtimeDashboard(
    siteId,
    {
      onCallCreated: () => {
        fetchUnscoredIntents();
      },
      onCallUpdated: () => {
        fetchUnscoredIntents();
      },
    },
    { adsOnly: true }
  );

  const handleQualified = useCallback(() => {
    // Intent was qualified, refresh the list
    fetchUnscoredIntents();
  }, [fetchUnscoredIntents]);

  const handleOpenSession = useCallback((intent: IntentForQualification) => {
    setSelectedIntent(intent);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setSelectedIntent(null);
  }, []);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">
            Intent Qualification Queue
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border border-rose-200 bg-rose-50">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <Icons.alert className="w-10 h-10 text-rose-600 mb-2" />
          <p className="text-rose-800 text-sm mb-4">Failed to load intents: {error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchUnscoredIntents()}
            className="bg-background border-rose-300 text-rose-800 hover:bg-rose-100"
          >
            <Icons.refresh className="w-3 h-3 mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (intents.length === 0) {
    return (
      <>
        <Card className="border-2 border-dashed border-border bg-muted/20">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Icons.check className="w-16 h-16 text-green-500 mb-4" />
            <h3 className="text-xl font-semibold mb-2">All Caught Up!</h3>
            <p className="text-muted-foreground max-w-md">
              No pending intents to qualify. New intents from Google Ads will appear here automatically.
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fetchUnscoredIntents()}
              className="mt-4"
            >
              <Icons.refresh className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </CardContent>
        </Card>

        {/* Session Drawer */}
        {selectedIntent && selectedIntent.matched_session_id && (
          <LazySessionDrawer
            siteId={siteId}
            intent={{
              id: selectedIntent.id,
              created_at: selectedIntent.created_at,
              intent_action: selectedIntent.intent_action,
              intent_target: selectedIntent.intent_target,
              intent_page_url: selectedIntent.intent_page_url,
              intent_stamp: null,
              matched_session_id: selectedIntent.matched_session_id,
              lead_score: selectedIntent.lead_score,
              status: selectedIntent.status,
              click_id: selectedIntent.click_id,
            }}
            onClose={handleCloseDrawer}
          />
        )}
      </>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold">
              Intent Qualification Queue
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-amber-100 text-amber-800 border-amber-200">
                {intents.length} Pending
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => fetchUnscoredIntents()}
                title="Refresh"
              >
                <Icons.refresh className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {intents.map((intent) => (
              <IntentQualificationCard
                key={intent.id}
                siteId={siteId}
                intent={intent}
                onQualified={handleQualified}
                onOpenSession={handleOpenSession}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Session Drawer */}
      {selectedIntent && selectedIntent.matched_session_id && (
        <LazySessionDrawer
          siteId={siteId}
          intent={{
            id: selectedIntent.id,
            created_at: selectedIntent.created_at,
            intent_action: selectedIntent.intent_action,
            intent_target: selectedIntent.intent_target,
            intent_page_url: selectedIntent.intent_page_url,
            intent_stamp: null,
            matched_session_id: selectedIntent.matched_session_id,
            lead_score: selectedIntent.lead_score,
            status: selectedIntent.status,
            click_id: selectedIntent.click_id,
          }}
          onClose={handleCloseDrawer}
        />
      )}
    </>
  );
}
