/**
 * Watchtower GO W1 — Structured logger.
 * JSON logs: level, msg, request_id?, route?, site_id?, user_id?
 * Verbose logs gated by OPSMANTIK_DEBUG=1.
 */

const DEBUG = process.env.OPSMANTIK_DEBUG === '1' || process.env.OPSMANTIK_DEBUG === 'true';

export type LogContext = {
  request_id?: string;
  route?: string;
  site_id?: string;
  user_id?: string;
  [key: string]: unknown;
};

function formatLog(level: string, msg: string, context?: LogContext): string {
  const payload = {
    level,
    msg,
    ts: new Date().toISOString(),
    ...context,
  };
  return JSON.stringify(payload);
}

function write(level: string, msg: string, context?: LogContext): void {
  const line = formatLog(level, msg, context);
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
}

/**
 * Info-level log. Always emitted.
 */
export function logInfo(msg: string, context?: LogContext): void {
  write('info', msg, context);
}

/**
 * Error-level log. Always emitted.
 */
export function logError(msg: string, context?: LogContext): void {
  write('error', msg, context);
}

/**
 * Debug-level log. Only when OPSMANTIK_DEBUG=1.
 */
export function logDebug(msg: string, context?: LogContext): void {
  if (DEBUG) {
    write('debug', msg, context);
  }
}

/**
 * Warn-level log. Always emitted.
 */
export function logWarn(msg: string, context?: LogContext): void {
  write('warn', msg, context);
}
