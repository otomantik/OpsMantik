/**
 * Session burst / click-chain reuse RPC is default ON so dual-path ingest cannot
 * silently create sibling sessions. Tests or local quirks: INTENT_SESSION_REUSE_HARDENING=0|false|off
 */
export function intentSessionReuseHardeningEnabledFromEnv(
    env: Pick<NodeJS.ProcessEnv, 'INTENT_SESSION_REUSE_HARDENING'> = process.env
): boolean {
    const v = env.INTENT_SESSION_REUSE_HARDENING;
    if (v === undefined || v === '') return true;
    const n = String(v).trim().toLowerCase();
    if (['0', 'false', 'off', 'no', 'disable', 'disabled'].includes(n)) return false;
    if (['1', 'true', 'on', 'yes', 'enable', 'enabled'].includes(n)) return true;
    return true;
}

export function intentSessionReuseHardeningEnabled(): boolean {
    return intentSessionReuseHardeningEnabledFromEnv(process.env);
}
