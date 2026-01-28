'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Icons, Spinner } from '@/components/icons';
import { useIntentQualification, type QualifyIntentParams } from '@/lib/hooks/use-intent-qualification';
import { formatTimestamp } from '@/lib/utils';
import { cn } from '@/lib/utils';

export interface IntentForQualification {
  id: string;
  created_at: string;
  intent_action: 'phone' | 'whatsapp' | 'form' | string | null;
  intent_target: string | null;
  intent_page_url: string | null;
  matched_session_id: string | null;
  lead_score: number | null;
  status: string | null;
  click_id: string | null;
}

interface IntentQualificationCardProps {
  siteId: string;
  intent: IntentForQualification;
  onQualified?: () => void;  // Callback after successful qualification
  onOpenSession?: (intent: IntentForQualification) => void;  // Open session drawer
}

export function IntentQualificationCard({
  siteId,
  intent,
  onQualified,
  onOpenSession,
}: IntentQualificationCardProps) {
  const [selectedScore, setSelectedScore] = useState<1 | 2 | 3 | 4 | 5 | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<'confirmed' | 'junk' | null>(null);
  const [note, setNote] = useState('');
  const [showNoteInput, setShowNoteInput] = useState(false);

  const { qualify, saving, error, clearError } = useIntentQualification(siteId, intent.id);

  const handleSave = async () => {
    if (!selectedScore || !selectedStatus) {
      return; // Should not happen (button disabled)
    }

    const params: QualifyIntentParams = {
      score: selectedScore,
      status: selectedStatus,
      note: note.trim() || undefined,
    };

    const result = await qualify(params);

    if (result.success) {
      // Success! Notify parent to refresh list
      onQualified?.();
    }
  };

  const canSave = selectedScore !== null && selectedStatus !== null && !saving;

  // Badge color based on intent type
  const getTypeBadge = () => {
    const action = (intent.intent_action || '').toLowerCase();
    if (action === 'phone') {
      return (
        <Badge className="bg-blue-100 text-blue-700 border-blue-200">
          <Icons.phone className="w-3 h-3 mr-1" />
          Phone
        </Badge>
      );
    }
    if (action === 'whatsapp') {
      return (
        <Badge className="bg-green-100 text-green-700 border-green-200">
          <Icons.whatsappBrand className="w-3 h-3 mr-1" />
          WhatsApp
        </Badge>
      );
    }
    if (action === 'form') {
      return (
        <Badge className="bg-purple-100 text-purple-700 border-purple-200">
          <Icons.form className="w-3 h-3 mr-1" />
          Form
        </Badge>
      );
    }
    return (
      <Badge variant="secondary">
        <Icons.circleDot className="w-3 h-3 mr-1" />
        Unknown
      </Badge>
    );
  };

  const formatTarget = (target: string | null) => {
    if (!target) return '—';
    if (target.length <= 15) return target;
    return `${target.slice(0, 12)}...`;
  };

  const formatClickId = (intent: IntentForQualification) => {
    // calls table stores best-effort click id in click_id (could be gclid/wbraid/gbraid)
    const v = intent.click_id;
    if (!v) return null;

    // Light heuristics for display label (avoid relying on non-existent calls.* columns)
    const lower = v.toLowerCase();
    const label =
      lower.startsWith('gclid') ? 'GCLID' :
      lower.startsWith('wbraid') ? 'WBRAID' :
      lower.startsWith('gbraid') ? 'GBRAID' :
      'Click ID';

    const cleaned = v.replace(/^(gclid|wbraid|gbraid)\s*[:=]?\s*/i, '');
    const short = cleaned.length <= 14 ? cleaned : `${cleaned.slice(0, 12)}…`;
    return `${label}: ${short}`;
  };

  const clickIdDisplay = formatClickId(intent);

  return (
    <Card className="border border-border bg-background shadow-sm hover:shadow transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Icons.clock className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-medium tabular-nums">
                {formatTimestamp(intent.created_at)}
              </span>
              {getTypeBadge()}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="truncate">{formatTarget(intent.intent_target)}</span>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Intent Details */}
        <div className="space-y-2 text-sm">
          {intent.intent_page_url && (
            <div className="flex items-start gap-2">
              <Icons.externalLink className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
              <span className="text-muted-foreground truncate">
                {intent.intent_page_url}
              </span>
            </div>
          )}

          {clickIdDisplay && (
            <div className="flex items-start gap-2">
              <Icons.google className="w-4 h-4 shrink-0 mt-0.5" />
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <span className="text-muted-foreground font-mono text-sm cursor-help">
                      {clickIdDisplay}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-sm">Click to view session details</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )}

          {intent.matched_session_id && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-sm"
              onClick={() => onOpenSession?.(intent)}
            >
              <Icons.externalLink className="w-3 h-3 mr-2" />
              View Session Details
            </Button>
          )}
        </div>

        <div className="border-t border-border pt-3 space-y-3">
          {/* Score Selection */}
          <div>
            <label className="text-sm font-medium mb-2 block">
              <span className="inline-flex items-center gap-2">
                <Icons.star className="w-4 h-4 text-amber-600" />
                Lead Quality (1–5)
              </span>
            </label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((score) => (
                <Button
                  key={score}
                  variant={selectedScore === score ? 'default' : 'outline'}
                  size="sm"
                  className={cn(
                    'w-11 h-11 text-base font-semibold tabular-nums',
                    selectedScore === score && 'bg-amber-500 hover:bg-amber-600 text-white'
                  )}
                  onClick={() => setSelectedScore(score as 1 | 2 | 3 | 4 | 5)}
                  disabled={saving}
                >
                  {score}
                </Button>
              ))}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              1 = Low quality, 5 = High quality lead
            </p>
          </div>

          {/* Status Selection */}
          <div>
            <label className="text-sm font-medium mb-2 block">
              <span className="inline-flex items-center gap-2">
                <Icons.tag className="w-4 h-4 text-muted-foreground" />
                Status
              </span>
            </label>
            <div className="flex gap-2">
              <Button
                variant={selectedStatus === 'confirmed' ? 'default' : 'outline'}
                size="sm"
                className={cn(
                  'flex-1',
                  selectedStatus === 'confirmed' && 'bg-green-600 hover:bg-green-700 text-white'
                )}
                onClick={() => setSelectedStatus('confirmed')}
                disabled={saving}
              >
                <Icons.check className="w-4 h-4 mr-2" />
                Sealed (Real)
              </Button>
              <Button
                variant={selectedStatus === 'junk' ? 'default' : 'outline'}
                size="sm"
                className={cn(
                  'flex-1',
                  selectedStatus === 'junk' && 'bg-red-600 hover:bg-red-700 text-white'
                )}
                onClick={() => setSelectedStatus('junk')}
                disabled={saving}
              >
                <Icons.x className="w-4 h-4 mr-2" />
                Junk (Spam)
              </Button>
            </div>
          </div>

          {/* Note Input (Optional) */}
          {showNoteInput ? (
            <div>
              <label className="text-sm font-medium mb-2 block">
                <span className="inline-flex items-center gap-2">
                  <Icons.clipboard className="w-4 h-4 text-muted-foreground" />
                  Note (optional)
                </span>
              </label>
              <Textarea
                placeholder="e.g., Gerçek müşteri, antika saat sordu..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="resize-none h-20"
                disabled={saving}
              />
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowNoteInput(true)}
              disabled={saving}
            >
              <Icons.clipboard className="w-4 h-4 mr-2" />
              Add Note
            </Button>
          )}

          {/* Error Display */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
              <Icons.alert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-red-800">{error}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto p-0 text-red-600 hover:text-red-800 mt-1"
                  onClick={clearError}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          )}

          {/* Save Button */}
          <Button
            className="w-full"
            size="lg"
            onClick={handleSave}
            disabled={!canSave}
          >
            {saving ? (
              <>
                <Spinner className="w-4 h-4 mr-2" />
                Saving...
              </>
            ) : (
              <>
                <Icons.check className="w-4 h-4 mr-2" />
                Save Qualification
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
