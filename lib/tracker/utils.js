/**
 * Tracker Utilities
 */

export function generateFingerprint() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillText('Fingerprint', 2, 2);

    const fingerprint = [
        navigator.userAgent,
        navigator.language,
        screen.width + 'x' + screen.height,
        new Date().getTimezoneOffset(),
        canvas.toDataURL(),
    ].join('|');

    let hash = 0;
    for (let i = 0; i < fingerprint.length; i++) {
        const char = fingerprint.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

export function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

export function rand4() {
    return Math.random().toString(36).slice(2, 6).padEnd(4, '0');
}

export function hash6(str) {
    const s = (str || '').toString();
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h) + s.charCodeAt(i);
        h |= 0;
    }
    const out = Math.abs(h).toString(36);
    return out.slice(0, 6).padEnd(6, '0');
}

export function makeIntentStamp(actionShort, target) {
    const ts = Date.now();
    const tHash = hash6((target || '').toString().toLowerCase());
    return `${ts}-${rand4()}-${actionShort}-${tHash}`;
}

export function getHardwareMeta() {
    const o = {};
    try { if (navigator.language) o.lan = navigator.language; } catch (e) { }
    try { if (typeof navigator.deviceMemory === 'number') o.mem = navigator.deviceMemory; } catch (e) { }
    try { if (typeof navigator.hardwareConcurrency === 'number') o.con = navigator.hardwareConcurrency; } catch (e) { }
    try { if (typeof screen !== 'undefined') { o.sw = screen.width; o.sh = screen.height; } } catch (e) { }
    try { if (typeof window.devicePixelRatio === 'number') o.dpr = window.devicePixelRatio; } catch (e) { }
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (gl) {
            const ext = gl.getExtension('WEBGL_debug_renderer_info');
            if (ext) { const r = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL); if (r) o.gpu = r; }
        }
    } catch (e) { }
    try {
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (conn && conn.effectiveType) o.con_type = conn.effectiveType;
    } catch (e) { }
    return o;
}
