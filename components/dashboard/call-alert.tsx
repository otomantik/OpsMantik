'use client';

/**
 * CallAlertComponent - Displays phone call matches with evidence fields
 * 
 * Acceptance Criteria (see docs/DEV_CHECKLIST.md):
 * - "View Session" button jumps + highlights correct session card
 * - Shows evidence fields: masked fingerprint, window 30m, score/breakdown
 * - Handles edge cases: no match, missing breakdown, legacy calls
 * 
 * Security: Uses anon key only (createClient), no service role leakage
 */
import { useEffect, useRef, useState, memo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Phone, X, CheckCircle2, XCircle, ChevronDown, ChevronUp, ExternalLink, Info } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { jumpToSession, maskFingerprint, getConfidence } from '@/lib/utils';

interface CallAlert {
  id: string;
  phone_number: string;
  matched_session_id: string | null;
  matched_fingerprint?: string | null;
  lead_score: number;
  lead_score_at_match?: number | null;
  score_breakdown?: {
    conversionPoints: number;
    interactionPoints: number;
    bonuses: number;
    cappedAt100: boolean;
    rawScore?: number;
    finalScore?: number;
  } | null;
  matched_at?: string | null;
  created_at: string;
  status?: string | null; // intent, confirmed, qualified, junk, real, null
  source?: string | null; // click, api, manual
  confirmed_at?: string | null;
  confirmed_by?: string | null;
}

interface CallAlertProps {
  call: CallAlert;
  onDismiss: (id: string) => void;
  isNewMatch?: boolean;
}

export const CallAlertComponent = memo(function CallAlertComponent({ call, onDismiss, isNewMatch = false }: CallAlertProps) {
  const [isFlashing, setIsFlashing] = useState(isNewMatch);
  const [status, setStatus] = useState(call.status);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showSessionNotFound, setShowSessionNotFound] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Play sonar sound and flash border on new match
  useEffect(() => {
    if (isNewMatch) {
      // Play sonar sound
      try {
        const audio = new Audio('/sonar.mp3');
        audio.volume = 0.3;
        audio.play().catch(err => {
          console.warn('[CALL_ALERT] Audio play failed:', err);
        });
        audioRef.current = audio;
      } catch (err) {
        console.warn('[CALL_ALERT] Audio not available');
      }

      // Flash border 3 times
      let flashCount = 0;
      const flashInterval = setInterval(() => {
        setIsFlashing(true);
        setTimeout(() => {
          setIsFlashing(false);
          flashCount++;
          if (flashCount >= 3) {
            clearInterval(flashInterval);
          }
        }, 200);
      }, 400);

      return () => {
        clearInterval(flashInterval);
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current = null;
        }
      };
    }
  }, [isNewMatch]);

  const getScoreBadge = (score: number) => {
    if (score >= 80) return 'bg-rose-500/20 text-rose-400 border border-rose-500/50';
    if (score >= 60) return 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50';
    return 'bg-slate-700/50 text-slate-300 border border-slate-600/50';
  };


  const handleViewSession = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (call.matched_session_id) {
      const success = jumpToSession(call.matched_session_id);
      if (!success) {
        // Show inline feedback for 2 seconds
        setShowSessionNotFound(true);
        setTimeout(() => {
          setShowSessionNotFound(false);
        }, 2000);
      }
    }
  };


  const handleQualify = async () => {
    const supabase = createClient();
    const { error } = await supabase
      .from('calls')
      .update({ status: 'qualified' })
      .eq('id', call.id);

    if (!error) {
      setStatus('qualified');
    } else {
      console.error('[CALL_ALERT] Failed to qualify call:', error);
    }
  };

  const handleConfirm = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    const { error } = await supabase
      .from('calls')
      .update({ 
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        confirmed_by: user?.id || null,
      })
      .eq('id', call.id);

    if (!error) {
      setStatus('confirmed');
      // Optionally create a conversion event (can be done server-side or here)
      console.log('[CALL_ALERT] Intent confirmed, conversion should be tracked');
    } else {
      console.error('[CALL_ALERT] Failed to confirm intent:', error);
    }
  };

  const handleJunk = async () => {
    const supabase = createClient();
    const { error } = await supabase
      .from('calls')
      .update({ status: 'junk' })
      .eq('id', call.id);

    if (!error) {
      setStatus('junk');
      // Auto-dismiss junk calls after a short delay
      setTimeout(() => {
        onDismiss(call.id);
      }, 1000);
    } else {
      console.error('[CALL_ALERT] Failed to mark call as junk:', error);
    }
  };

  const isQualified = status === 'qualified';
  const isJunk = status === 'junk';
  const isIntent = status === 'intent';
  const isConfirmed = status === 'confirmed';
  const isReal = status === 'real' || (!isIntent && !isConfirmed && call.matched_at); // Real call has matched_at
  const confidence = getConfidence(call.lead_score);

  return (
    <Card 
      ref={cardRef}
      className={`
        glass border transition-all duration-200
        ${isFlashing ? 'border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.6)]' : getScoreBadge(call.lead_score).split(' ')[1]}
        ${isQualified ? 'border-emerald-500/50' : ''}
        ${isJunk ? 'border-slate-600/30 opacity-60' : ''}
      `}
    >
      <CardContent className="p-0">
        {/* Main Card Content */}
        <div className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            {/* Left: Phone & Score */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Phone className="w-4 h-4 text-slate-400 flex-shrink-0" />
                <p className="font-mono font-bold text-lg text-slate-100 truncate">
                  {call.phone_number}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap mt-2">
                <span className={`font-mono text-xs px-2 py-1 rounded font-bold ${getScoreBadge(call.lead_score)}`}>
                  Score: {call.lead_score}
                </span>
                {isIntent && (
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 font-semibold">
                    INTENT
                  </span>
                )}
                {isReal && call.matched_session_id && (
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    ✓ MATCH
                  </span>
                )}
                {isConfirmed && (
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 font-semibold">
                    CONFIRMED
                  </span>
                )}
                {call.matched_session_id && !isIntent && (
                  <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 ${confidence.color} border border-slate-600/50`}>
                    {confidence.label}
                  </span>
                )}
                {!call.matched_session_id && !isIntent && (
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">
                    NO MATCH
                  </span>
                )}
                {isReal && (
                  <span className="font-mono text-[10px] text-slate-500">
                    Window: 30m
                  </span>
                )}
              </div>
            </div>

            {/* Right: Actions */}
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {call.matched_session_id && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleViewSession}
                    className="h-7 px-2 text-xs font-mono text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 border border-emerald-500/30"
                    title="Jump to Session"
                  >
                    <ExternalLink className="w-3 h-3 mr-1" />
                    View Session
                  </Button>
                )}
                {!call.matched_session_id && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled
                    className="h-7 px-2 text-xs font-mono text-slate-500 border border-slate-700/30"
                    title="No session matched"
                  >
                    <ExternalLink className="w-3 h-3 mr-1" />
                    View Session
                  </Button>
                )}
                {isIntent && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleConfirm}
                    disabled={isConfirmed}
                    className={`h-7 px-2 text-xs font-mono ${
                      isConfirmed
                        ? 'text-blue-400 bg-blue-500/20 border border-blue-500/30'
                        : 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 border border-emerald-500/30'
                    }`}
                    title="Confirm Intent"
                  >
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Confirm
                  </Button>
                )}
                {!isIntent && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleQualify}
                    disabled={isQualified || isJunk}
                    className={`h-7 w-7 p-0 ${
                      isQualified 
                        ? 'text-emerald-400 bg-emerald-500/20' 
                        : 'text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10'
                    }`}
                    title="Mark as Qualified"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleJunk}
                  disabled={isJunk || isQualified || isConfirmed}
                  className={`h-7 w-7 p-0 ${
                    isJunk 
                      ? 'text-slate-500 bg-slate-700/30' 
                      : 'text-slate-400 hover:text-red-400 hover:bg-red-500/10'
                  }`}
                  title="Mark as Junk"
                >
                  <XCircle className="w-4 h-4" />
                </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsExpanded(!isExpanded)}
                className="h-7 w-7 p-0 text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                title="View Details"
              >
                {isExpanded ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onDismiss(call.id)}
                className="h-7 w-7 p-0 text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                title="Dismiss"
              >
                <X className="w-4 h-4" />
              </Button>
              </div>
              {/* Session not found feedback */}
              {showSessionNotFound && (
                <p className="text-[10px] font-mono text-yellow-400 animate-pulse mt-0.5">
                  ⚠️ Session not in current view
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Expanded Details Section */}
        {isExpanded && (
          <div className="border-t border-slate-800/50 p-3 space-y-3 bg-slate-900/30">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Info className="w-3.5 h-3.5 text-slate-400" />
                <p className="font-mono text-xs font-semibold text-slate-300">MATCHING DETAILS</p>
              </div>
              <div className="space-y-2 text-xs font-mono">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Fingerprint:</span>
                  <span className="text-slate-300 text-[10px]">{maskFingerprint(call.matched_fingerprint)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Session ID:</span>
                  <span className="text-slate-300 text-[10px]">
                    {call.matched_session_id ? `${call.matched_session_id.slice(0, 8)}...` : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Score:</span>
                  <span className="text-slate-300">
                    {call.lead_score_at_match ?? call.lead_score}
                  </span>
                </div>
                {call.matched_at && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Matched At:</span>
                    <span className="text-slate-300 text-[10px]">
                      {new Date(call.matched_at).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Confidence:</span>
                  <span className={confidence.color}>{confidence.label}</span>
                </div>
              </div>
            </div>

            {/* Score Breakdown */}
            <div className="pt-2 border-t border-slate-800/30">
              <p className="font-mono text-xs text-slate-400 mb-2">SCORE BREAKDOWN</p>
              {call.score_breakdown ? (
                <div className="space-y-1 text-xs font-mono">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Conversion Points:</span>
                    <span className="text-slate-300">{call.score_breakdown.conversionPoints}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Interaction Points:</span>
                    <span className="text-slate-300">{call.score_breakdown.interactionPoints}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Bonuses:</span>
                    <span className="text-slate-300">{call.score_breakdown.bonuses}</span>
                  </div>
                  {call.score_breakdown.rawScore !== undefined && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Raw Score:</span>
                      <span className="text-slate-300">{call.score_breakdown.rawScore}</span>
                    </div>
                  )}
                  {call.score_breakdown.cappedAt100 && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Capped:</span>
                      <span className="text-yellow-400">Yes (at 100)</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-1 border-t border-slate-800/30">
                    <span className="text-slate-400 font-semibold">Final Score:</span>
                    <span className="text-emerald-400 font-bold">{call.score_breakdown.finalScore ?? call.lead_score}</span>
                  </div>
                </div>
              ) : (
                <div className="text-[10px] text-slate-500 font-mono">
                  Score breakdown not available
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}, (prevProps, nextProps) => {
  // Custom comparison: only re-render if call object reference or isNewMatch changes
  return prevProps.call.id === nextProps.call.id &&
         prevProps.call.status === nextProps.call.status &&
         prevProps.isNewMatch === nextProps.isNewMatch &&
         prevProps.onDismiss === nextProps.onDismiss;
});
