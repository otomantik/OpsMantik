import { Client } from '@upstash/qstash';
import { assertQstashEnv } from './env';

// Fail-fast on import in production.
assertQstashEnv();

/**
 * Centralized QStash client.
 *
 * Note: In production, env presence is guaranteed by assertQstashEnv().
 * In dev/preview, we keep behavior permissive to avoid blocking local work.
 */
export const qstash = new Client({ token: process.env.QSTASH_TOKEN || '' });

