/**
 * Intent Pulse - accumulation of user behavior
 */
import { CONFIG } from './config';

export const pulse = {
    maxScroll: 0,
    sentScroll50: false,
    sentScroll90: false,
    ctaHovers: 0,
    focusDur: 0,
    activeSec: 0,
    lastActiveAt: typeof Date !== 'undefined' ? Date.now() : 0,
};

export function getPulseMeta() {
    const o = {};
    if (pulse.maxScroll > 0) o.scroll_pct = Math.min(100, pulse.maxScroll);
    if (pulse.ctaHovers > 0) o.cta_hovers = pulse.ctaHovers;
    if (pulse.focusDur > 0) o.focus_dur = pulse.focusDur;
    if (pulse.activeSec > 0) o.active_sec = pulse.activeSec;

    let startTs = 0;
    try {
        startTs = parseInt(sessionStorage.getItem(CONFIG.sessionStartKey) || '0', 10);
    } catch { }

    if (startTs > 0) {
        o.duration_sec = Math.round((Date.now() - startTs) / 1000);
    }
    return o;
}
