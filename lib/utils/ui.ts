import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Enterprise class name merger.
 * Combines clsx for conditional classes and tailwind-merge to handle conflict resolution.
 */
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/**
 * Jump to a session card and highlight it temporarily
 * 
 * Acceptance: "View Session" from Call Monitor jumps + highlights correct session card
 * Edge Cases: Session not found (console warning, no action), concurrent clicks (last wins)
 * 
 * @param sessionId - Full session ID to jump to
 * @returns true if session found and highlighted, false if not found
 */
export function jumpToSession(sessionId: string): boolean {
    if (typeof document === 'undefined') return false;

    const element = document.querySelector(`[data-session-id="${sessionId}"]`);
    if (!element) {
        console.warn('[jumpToSession] Session not found:', sessionId);
        return false;
    }

    // Scroll into view with smooth behavior
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Add highlight classes
    const classes = ['ring-2', 'ring-emerald-500', 'ring-offset-2', 'ring-offset-slate-900', 'animate-pulse'];
    element.classList.add(...classes);

    // Remove highlight after 1.5s
    setTimeout(() => {
        element.classList.remove(...classes);
    }, 1500);

    return true;
}

// Global exposure for non-React call sites
declare global {
  interface Window {
    jumpToSession?: typeof jumpToSession;
  }
}
if (typeof window !== 'undefined') {
  window.jumpToSession = jumpToSession;
}
