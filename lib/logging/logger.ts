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
    // eslint-disable-next-line no-console
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

