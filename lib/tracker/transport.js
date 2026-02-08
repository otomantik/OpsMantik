/**
 * Tracker Transport Layer (Outbox / Fetch / Beacon)
 */
import { CONFIG } from './config';
import { generateUUID } from './utils';

const QUEUE_KEY = 'opsmantik_outbox_v2';
let isProcessing = false;

function getQueue() {
    try {
        return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    } catch (e) { return []; }
}

function saveQueue(queue) {
    try {
        localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    } catch (e) { }
}

export async function processOutbox() {
    if (isProcessing) return;
    const queue = getQueue();
    if (queue.length === 0) return;

    isProcessing = true;
    const currentEnvelope = queue[0];

    try {
        // TTL check (24h)
        if (currentEnvelope.attempts > 10 && (Date.now() - currentEnvelope.ts > 86400000)) {
            queue.shift();
            saveQueue(queue);
            isProcessing = false;
            processOutbox();
            return;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(CONFIG.apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(currentEnvelope.payload),
            keepalive: true,
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
            queue.shift();
            saveQueue(queue);
            isProcessing = false;
            processOutbox();
        } else {
            throw new Error('Server status: ' + response.status);
        }
    } catch (err) {
        currentEnvelope.attempts++;
        saveQueue(queue);
        isProcessing = false;
        setTimeout(processOutbox, 5000);
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
        attempts: 0
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
