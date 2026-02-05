/**
 * Watchtower GO W1 — Structured logger.
 * JSON logs: level, msg, request_id?, route?, site_id?, user_id?
 * Verbose logs gated by OPSMANTIK_DEBUG=1.
 */

import { logger } from '@/lib/logging/logger';

export type LogContext = {
  request_id?: string;
  route?: string;
  site_id?: string;
  user_id?: string;
  [key: string]: unknown;
};

/**
 * Info-level log. Always emitted.
 */
export function logInfo(msg: string, context?: LogContext): void {
  logger.info(msg, context);
}

/**
 * Error-level log. Always emitted.
 */
export function logError(msg: string, context?: LogContext): void {
  logger.error(msg, context);
}

/**
 * Debug-level log. Only when OPSMANTIK_DEBUG=1.
 */
export function logDebug(msg: string, context?: LogContext): void {
  logger.debug(msg, context);
}

/**
 * Warn-level log. Always emitted.
 */
export function logWarn(msg: string, context?: LogContext): void {
  logger.warn(msg, context);
}
