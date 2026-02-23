/**
 * Tracker Transport Layer (Outbox / Fetch / Beacon)
 * P0: Status-aware backoff. Tag-Manager-grade: batch send + throttle.
 */
import { CONFIG } from './config';
import { generateUUID } from './utils';

const QUEUE_KEY = 'opsmantik_outbox_v2';
const DEAD_LETTER_KEY = 'opsmantik_dead_letters';
const MAX_DEAD_LETTERS = 20;
const JITTER_MS = 3000;
const MAX_BATCH = 20;
const MIN_FLUSH_INTERVAL_MS = 2000;
const PAYLOAD_CAP_BYTES = 50 * 1024;
const BATCH_RETRY_AFTER_MS = 5 * 60 * 1000;
let isProcessing = false;
let batchSupported = true;
let batchRetryAt = 0;
let lastFlushAt = 0;

function appendDeadLetter(envelope, status) {
    if (typeof localStorage === 'undefined') return;
    try {
        const payload = envelope.payload || {};
        const ec = payload.ec;
        const ea = payload.ea;
        const attempts = envelope.attempts ?? 0;
        let list = [];
        try {
            list = JSON.parse(localStorage.getItem(DEAD_LETTER_KEY) || '[]');
        } catch { list = []; }
        list.push({ ts: Date.now(), status, ec, ea, attempts });
        if (list.length > MAX_DEAD_LETTERS) list = list.slice(-MAX_DEAD_LETTERS);
        localStorage.setItem(DEAD_LETTER_KEY, JSON.stringify(list));
    } catch { /* never break tracker */ }
}

/**
 * Returns delay and whether to retry. 429: min 30s, x2, cap 10min + jitter. 5xx/network: min 5s, x2, cap 2min + jitter. Other 4xx: no retry.
 * @param {number|undefined} status - HTTP status (undefined = network/abort, use 5xx policy)
 * @param {number} attempts - current attempt count (before increment for this failure)
 * @returns {{ delayMs: number, retry: boolean }}
 */
export function getRetryDelayMs(status, attempts) {
    if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) {
        return { delayMs: 0, retry: false };
    }
    const jitter = Math.floor(Math.random() * (JITTER_MS + 1));
    if (status === 429) {
        const base = Math.min(600000, Math.max(30000, 30000 * Math.pow(2, attempts)));
        return { delayMs: base + jitter, retry: true };
    }
    // 5xx or undefined (network/abort)
    const base = Math.min(120000, Math.max(5000, 5000 * Math.pow(2, attempts)));
    return { delayMs: base + jitter, retry: true };
}

function getQueue() {
    try {
        return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    } catch { return []; }
}

function saveQueue(queue) {
    try {
        localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    } catch { }
}

function parseStatusFromError(err) {
    if (err && typeof err.message === 'string') {
        const m = err.message.match(/Server status: (\d+)/);
        if (m) return parseInt(m[1], 10);
    }
    return undefined;
}

export async function processOutbox() {
    if (isProcessing) return;
    const queue = getQueue();
    if (queue.length === 0) return;

    const currentEnvelope = queue[0];
    const nextAt = currentEnvelope.nextAttemptAt;
    const now = Date.now();
    if (nextAt != null && nextAt > 0 && nextAt > now) {
        const waitMs = nextAt - now;
        setTimeout(processOutbox, waitMs);
        return;
    }

    isProcessing = true;
    let batch = [];

    try {
        // Drop TTL-expired from front
        while (queue.length && queue[0].attempts > 10 && (now - (queue[0].ts || now)) > 86400000) {
            appendDeadLetter(queue[0], queue[0].lastStatus);
            queue.shift();
        }
        if (queue.length === 0) {
            saveQueue(queue);
            isProcessing = false;
            processOutbox();
            return;
        }
        saveQueue(queue);

        // Throttle: min interval between flushes
        if (lastFlushAt > 0 && now - lastFlushAt < MIN_FLUSH_INTERVAL_MS) {
            const delayMs = lastFlushAt + MIN_FLUSH_INTERVAL_MS - now;
            isProcessing = false;
            if (typeof localStorage !== 'undefined' && localStorage.getItem('opsmantik_debug') === '1') {
                console.log('[OPSMANTIK_DEBUG] throttle scheduled', { delayMs, lastFlushAt, now });
            }
            setTimeout(() => processOutbox(), delayMs);
            return;
        }

        if (batchRetryAt > 0 && now >= batchRetryAt) {
            batchSupported = true;
            batchRetryAt = 0;
        }
        const maxBatch = batchSupported ? MAX_BATCH : 1;
        const batch = [];
        let payloadBytes = 0;
        for (let i = 0; i < queue.length && batch.length < maxBatch; i++) {
            const env = queue[i];
            if (env.nextAttemptAt != null && env.nextAttemptAt > 0 && env.nextAttemptAt > now) break;
            if (env.attempts > 10 && (now - (env.ts || now)) > 86400000) continue;
            const envSize = JSON.stringify(env.payload).length;
            const addSize = batch.length === 0 ? envSize : envSize + 2;
            if (payloadBytes + addSize > PAYLOAD_CAP_BYTES) break;
            batch.push(env);
            payloadBytes += addSize;
        }
        if (batch.length === 0) {
            isProcessing = false;
            return;
        }

        const body = batch.length > 1
            ? JSON.stringify({ events: batch.map((e) => e.payload) })
            : JSON.stringify(batch[0].payload);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        lastFlushAt = now;

        const response = await fetch(CONFIG.apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            keepalive: true,
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        const throttled = false;
        const debug = typeof localStorage !== 'undefined' && localStorage.getItem('opsmantik_debug') === '1';

        let batchNotSupported = false;
        if (batch.length > 1 && !response.ok) {
            const st = response.status;
            if (st === 400 || st === 415) batchNotSupported = true;
            else if (st >= 400 && st < 500) {
                try {
                    const j = await response.clone().json();
                    if (j && typeof j === 'object') {
                        if (j.error === 'batch_not_supported' || j.code === 'BATCH_NOT_SUPPORTED') batchNotSupported = true;
                    }
                } catch { /* ignore */ }
            }
        }
        if (batchNotSupported) {
            batchSupported = false;
            batchRetryAt = now + BATCH_RETRY_AFTER_MS;
            isProcessing = false;
            if (debug) console.log('[OPSMANTIK_DEBUG] batch not supported', { batchRetryAt });
            processOutbox();
            return;
        }

        if (response.ok) {
            queue.splice(0, batch.length);
            saveQueue(queue);
            isProcessing = false;
            if (debug) {
                console.log('[OPSMANTIK_DEBUG] flush', { sentCount: batch.length, remainingQueueLength: queue.length, batchSupported, throttled });
            }
            processOutbox();
            return;
        }

        const status = response.status;
        const first = batch[0];
        const { delayMs, retry } = getRetryDelayMs(status, first.attempts);
        if (!retry) {
            first.dead = true;
            first.deadReason = '4xx';
            first.lastStatus = status;
            appendDeadLetter(first, status);
            if (debug) {
                console.warn('[OPSMANTIK_DEBUG] dead-letter', { status, ec: first.payload?.ec, ea: first.payload?.ea });
            }
            queue.splice(0, 1);
            saveQueue(queue);
            isProcessing = false;
            if (debug) {
                console.log('[OPSMANTIK_DEBUG] flush', { sentCount: 0, remainingQueueLength: queue.length, batchSupported, throttled });
            }
            processOutbox();
            return;
        }
        first.attempts++;
        first.nextAttemptAt = now + delayMs;
        first.lastStatus = status;
        saveQueue(queue);
        if (debug) {
            console.log('[OPSMANTIK_DEBUG] backoff', { status, attempts: first.attempts, delayMs, nextAttemptAt: first.nextAttemptAt });
        }
        isProcessing = false;
        if (debug) {
            console.log('[OPSMANTIK_DEBUG] flush', { sentCount: 0, remainingQueueLength: queue.length, batchSupported, throttled });
        }
        setTimeout(processOutbox, delayMs);
    } catch (err) {
        const first = batch && batch.length ? batch[0] : queue[0];
        const status = parseStatusFromError(err);
        const { delayMs, retry } = getRetryDelayMs(status, first.attempts);
        if (!retry) {
            first.dead = true;
            first.deadReason = '4xx';
            first.lastStatus = status;
            appendDeadLetter(first, status);
            if (typeof localStorage !== 'undefined' && localStorage.getItem('opsmantik_debug') === '1') {
                console.warn('[OPSMANTIK_DEBUG] dead-letter', { status: status != null ? status : 'parse-fail', ec: first.payload?.ec, ea: first.payload?.ea });
            }
            queue.splice(0, 1);
            saveQueue(queue);
            isProcessing = false;
            processOutbox();
            return;
        }
        console.warn('[TankTracker] Network Fail - Retrying later:', err.message);
        first.attempts++;
        first.nextAttemptAt = now + delayMs;
        first.lastStatus = status;
        saveQueue(queue);
        if (typeof localStorage !== 'undefined' && localStorage.getItem('opsmantik_debug') === '1') {
            console.log('[OPSMANTIK_DEBUG] backoff', { status: status != null ? status : 'network', attempts: first.attempts, delayMs, nextAttemptAt: first.nextAttemptAt });
            console.log('[OPSMANTIK_DEBUG] flush', { sentCount: 0, remainingQueueLength: queue.length, batchSupported, throttled: false });
        }
        isProcessing = false;
        setTimeout(processOutbox, delayMs);
    }
}

export function addToOutbox(payload) {
    const queue = getQueue();
    const envelopeId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : generateUUID();

    const envelope = {
        id: envelopeId,
        ts: Date.now(),
        payload: payload,
        attempts: 0,
        nextAttemptAt: 0,
        lastStatus: undefined
    };

    queue.push(envelope);
    if (queue.length > 100) {
        queue.splice(0, queue.length - 80);
    }

    saveQueue(queue);
    processOutbox();
}

export function lastGaspFlush() {
    const queue = getQueue();
    if (queue.length > 0 && navigator.sendBeacon) {
        navigator.sendBeacon(CONFIG.apiUrl, new Blob([JSON.stringify(queue[0].payload)], { type: 'application/json' }));
    }
}
