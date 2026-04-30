'use client';

import { useState } from 'react';
import type { HunterIntent, HunterIntentLite } from '@/lib/types/hunter';
import type { ActivityRow } from '@/components/dashboard/qualification-queue/activity-log-inline';

export type QueueRangeUi = { day: 'today' | 'yesterday'; fromIso: string; toIso: string };
export type QueueToastStateUi = null | { kind: 'success' | 'danger'; text: string };

export function useQueueUiState() {
  const [range, setRangeState] = useState<QueueRangeUi | null>(null);
  const [intents, setIntents] = useState<HunterIntentLite[]>([]);
  const [recentEntered, setRecentEntered] = useState<HunterIntentLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIntent, setSelectedIntent] = useState<HunterIntent | null>(null);
  const [detailsById, setDetailsById] = useState<Record<string, HunterIntent>>({});
  const [sealModalOpen, setSealModalOpen] = useState(false);
  const [intentForSeal, setIntentForSeal] = useState<HunterIntent | null>(null);
  const [sessionEvidence, setSessionEvidence] = useState<
    Record<string, { city?: string | null; district?: string | null; device_type?: string | null }>
  >({});
  const [history, setHistory] = useState<ActivityRow[]>([]);
  const [restoringIds, setRestoringIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<QueueToastStateUi>(null);
  const [adsOnly, setAdsOnly] = useState(false);
  const [showAll, setShowAll] = useState(false);

  return {
    range,
    setRangeState,
    intents,
    setIntents,
    recentEntered,
    setRecentEntered,
    loading,
    setLoading,
    error,
    setError,
    selectedIntent,
    setSelectedIntent,
    detailsById,
    setDetailsById,
    sealModalOpen,
    setSealModalOpen,
    intentForSeal,
    setIntentForSeal,
    sessionEvidence,
    setSessionEvidence,
    history,
    setHistory,
    restoringIds,
    setRestoringIds,
    toast,
    setToast,
    adsOnly,
    setAdsOnly,
    showAll,
    setShowAll,
  };
}
