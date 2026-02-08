/**
 * Minimal leveled logger.
 *
 * Goals:
 * - No direct console.* usage in app code paths (centralize here)
 * - Structured JSON logs for server; readable console logs for browser
 * - Debug disabled in production by default (env toggle)
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = Record<string, unknown> & {
  request_id?: string;
  route?: string;
  site_id?: string;
  user_id?: string;
};

/**
 * Check if debug logging is enabled.
 * Debug logs are shown when NODE_ENV !== "production" OR NEXT_PUBLIC_WARROOM_DEBUG is true.
 */
export function isDebugEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_WARROOM_DEBUG === 'true';
}

/** Only logs in dev or when NEXT_PUBLIC_WARROOM_DEBUG=1. */
export function debugLog(...args: unknown[]): void {
  if (isDebugEnabled()) {
    console.log(...args);
  }
}

/** Only warns in dev or when NEXT_PUBLIC_WARROOM_DEBUG=1. */
export function debugWarn(...args: unknown[]): void {
  if (isDebugEnabled()) {
    console.warn(...args);
  }
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function getMinLevel(): LogLevel {
  const env = (process.env.LOG_LEVEL || '').toLowerCase();
  if (env === 'debug' || env === 'info' || env === 'warn' || env === 'error') return env;
  // Default: debug off in production
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function shouldLog(level: LogLevel): boolean {
  // Explicit debug toggle still supported
  const debugEnv = process.env.OPSMANTIK_DEBUG === '1' || process.env.OPSMANTIK_DEBUG === 'true';
  const min = getMinLevel();
  if (level === 'debug' && !debugEnv && min !== 'debug') return false;
  return LEVELS[level] >= LEVELS[min];
}

function writeLine(level: LogLevel, msg: string, context?: LogContext): void {
  if (!shouldLog(level)) return;

  const ts = new Date().toISOString();
  if (isBrowser()) {
    // Browser: keep human-readable logs (still centralized).
    const payload = context ? { ...context } : undefined;
    const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    sink(`[${level.toUpperCase()}] ${msg}`, payload ?? '');
    return;
  }

  const line = JSON.stringify({ level, msg, ts, ...(context || {}) });
  const out = level === 'error' ? process.stderr : process.stdout;
  out.write(line + '\n');
}

export const logger = {
  debug(msg: string, context?: LogContext) {
    writeLine('debug', msg, context);
  },
  info(msg: string, context?: LogContext) {
    writeLine('info', msg, context);
  },
  warn(msg: string, context?: LogContext) {
    writeLine('warn', msg, context);
  },
  error(msg: string, context?: LogContext) {
    writeLine('error', msg, context);
  },
};

/** Info-level log. Always emitted. */
export function logInfo(msg: string, context?: LogContext): void {
  logger.info(msg, context);
}

/** Error-level log. Always emitted. */
export function logError(msg: string, context?: LogContext): void {
  logger.error(msg, context);
}

/** Debug-level log. Only when OPSMANTIK_DEBUG=1 or LOG_LEVEL=debug. */
export function logDebug(msg: string, context?: LogContext): void {
  logger.debug(msg, context);
}

/** Warn-level log. Always emitted. */
export function logWarn(msg: string, context?: LogContext): void {
  logger.warn(msg, context);
}

