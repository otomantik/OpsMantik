import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Check if debug logging is enabled
 * Debug logs are shown when NODE_ENV !== "production" OR NEXT_PUBLIC_WARROOM_DEBUG is true
 */
export function isDebugEnabled(): boolean {
  if (typeof window === 'undefined') {
    return process.env.NODE_ENV !== 'production' ||
           process.env.NEXT_PUBLIC_WARROOM_DEBUG === 'true';
  }
  return process.env.NODE_ENV !== 'production' ||
         process.env.NEXT_PUBLIC_WARROOM_DEBUG === 'true';
}

/** Only logs in dev or when NEXT_PUBLIC_WARROOM_DEBUG=1. Use in API routes to avoid prod noise. */
export function debugLog(...args: unknown[]): void {
  if (isDebugEnabled()) console.log(...args);
}

/** Only warns in dev or when NEXT_PUBLIC_WARROOM_DEBUG=1. */
export function debugWarn(...args: unknown[]): void {
  if (isDebugEnabled()) console.warn(...args);
}

/**
 * Jump to a session card and highlight it temporarily
 * 
 * Acceptance: "View Session" from Call Monitor jumps + highlights correct session card
 * Edge Cases: Session not found (console warning, no action), concurrent clicks (last wins)
 * 
 * @param sessionId - Full session ID to jump to
 * @returns true if session found and highlighted, false if not found
 * @see docs/DEV_CHECKLIST.md for full edge case documentation
 */
export function jumpToSession(sessionId: string): boolean {
  const element = document.querySelector(`[data-session-id="${sessionId}"]`);
  if (!element) {
    console.warn('[jumpToSession] Session not found:', sessionId);
    return false;
  }

  // Scroll into view with smooth behavior
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Add highlight classes
  element.classList.add('ring-2', 'ring-emerald-500', 'ring-offset-2', 'ring-offset-slate-900', 'animate-pulse');

  // Remove highlight after 1.5s
  setTimeout(() => {
    element.classList.remove('ring-2', 'ring-emerald-500', 'ring-offset-2', 'ring-offset-slate-900', 'animate-pulse');
  }, 1500);

  return true;
}

/**
 * Mask fingerprint for display
 * 
 * Handles edge cases:
 * - null/undefined/"" -> "—"
 * - length <= 8: show full fingerprint
 * - length > 8: show first4...last4 format
 * 
 * @param fp - Fingerprint string, null, or undefined
 * @returns Masked fingerprint string or "—" for empty values
 */
export function maskFingerprint(fp: string | null | undefined): string {
  if (!fp || fp.length === 0) {
    return '—';
  }
  if (fp.length <= 8) {
    return fp;
  }
  return `${fp.slice(0, 4)}...${fp.slice(-4)}`;
}

/**
 * Get confidence label and color based on lead score
 * 
 * Thresholds:
 * - score >= 80: HIGH (emerald-400)
 * - score >= 60: MEDIUM (yellow-400)
 * - score < 60: LOW (slate-400)
 * 
 * @param score - Lead score (0-100)
 * @returns Object with label ('HIGH' | 'MEDIUM' | 'LOW') and color class
 */
export function getConfidence(score: number): { label: 'HIGH' | 'MEDIUM' | 'LOW'; color: string } {
  if (score >= 80) {
    return { label: 'HIGH', color: 'text-emerald-400' };
  }
  if (score >= 60) {
    return { label: 'MEDIUM', color: 'text-yellow-400' };
  }
  return { label: 'LOW', color: 'text-muted-foreground' };
}

/**
 * Format timestamp with Europe/Istanbul timezone
 * 
 * Rule: Store UTC, display Europe/Istanbul consistently
 * 
 * @param ts - ISO timestamp string or null
 * @param options - Intl.DateTimeFormatOptions
 * @returns Formatted timestamp string or "—" for null
 */
export function formatTimestamp(
  ts: string | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  // FIX 2: Defensive parsing - handle invalid dates
  if (!ts) return '—';
  try {
    const date = new Date(ts);
    // Check if date is valid
    if (isNaN(date.getTime())) {
      console.warn('[formatTimestamp] Invalid date:', ts);
      return '—';
    }
    return date.toLocaleString('en-GB', {
      timeZone: 'Europe/Istanbul',
      ...options
    });
  } catch (err) {
    console.warn('[formatTimestamp] Error formatting:', ts, err);
    return '—';
  }
}

/**
 * Format timestamp with Europe/Istanbul timezone and TRT indicator
 * 
 * @param ts - ISO timestamp string or null
 * @param options - Intl.DateTimeFormatOptions
 * @returns Formatted timestamp with "(TRT)" suffix or "—" for null
 */
export function formatTimestampWithTZ(
  ts: string | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  if (!ts) return '—';
  const formatted = formatTimestamp(ts, options);
  return `${formatted} (TRT)`;
}

/**
 * Format relative time (e.g., "5m ago", "2h ago", "3d ago")
 * 
 * @param ts - ISO timestamp string or null
 * @returns Relative time string or "—" for null
 */
export function formatRelativeTime(ts: string | null | undefined): string {
  if (!ts) return '—';
  try {
    const date = new Date(ts);
    if (isNaN(date.getTime())) return '—';
    
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return formatTimestamp(ts, { month: 'short', day: 'numeric' });
  } catch {
    return '—';
  }
}

// Expose globally for external calls
if (typeof window !== 'undefined') {
  (window as any).jumpToSession = jumpToSession;
}
