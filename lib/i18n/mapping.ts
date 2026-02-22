import type { TranslationKey } from './t';

type TranslateFn = (key: TranslationKey, params?: Record<string, string | number>) => string;

/**
 * formatEventType - Human-readable event category/action for timeline.
 */
export function formatEventType(
    category: string | null | undefined,
    action: string | null | undefined,
    t: TranslateFn
): string {
    const c = (category || "").toLowerCase();
    const a = (action || "").toLowerCase();
    if (!c && !a) return "—";

    const catLabel =
        c === "acquisition"
            ? t("intent.acquisition")
            : c === "conversion"
              ? t("intent.conversion")
              : c === "interaction"
                ? t("intent.interaction")
                : c === "system"
                  ? t("event.system")
                  : category || "";

    const actLabel =
        a === "view"
            ? t("event.view")
            : a === "scroll_depth"
              ? t("event.scrollDepth")
              : a === "session_end"
                ? t("event.sessionEnd")
                : a === "page_unload"
                  ? t("event.pageUnload")
                  : a.includes("whatsapp")
                    ? t("event.whatsapp")
                    : a.includes("phone") || a.includes("call")
                      ? t("intent.call")
                      : action || "";

    if (catLabel && actLabel) return `${catLabel} / ${actLabel}`;
    return actLabel || catLabel || "—";
}

/**
 * formatActionType - Human-readable activity action_type for activity log.
 */
export function formatActionType(actionType: string | null | undefined, t: TranslateFn): string {
    const a = (actionType || "").toLowerCase();
    if (!a) return "—";
    if (a === "seal" || a === "confirm" || a === "confirmed" || a === "auto_approve") return t("activity.filterSeal");
    if (a === "junk" || a === "ai_junk") return t("activity.filterJunk");
    if (a === "cancel" || a === "cancelled") return t("activity.filterCancel");
    if (a === "restore" || a === "undo_restore" || a === "intent") return t("activity.filterRestore");
    if (a === "undo") return t("activity.filterUndo");
    return actionType || "—";
}

/**
 * getLocalizedLabel - Centralized mapper for database-level strings.
 * Ensures consistent translation of device types, attribution sources, and technical events.
 */
export function getLocalizedLabel(raw: string | null | undefined, t: TranslateFn): string {
    if (!raw) return '—';

    const l = raw.toLowerCase().trim();

    // Device types
    if (l === 'mobile') return t('device.mobile');
    if (l === 'desktop') return t('device.desktop');
    if (l === 'tablet') return t('device.tablet');
    if (l === 'iphone') return t('device.iphone');
    if (l === 'android') return t('device.android');

    // Attribution Sources / Dimensions
    if (l === 'google ads') return t('common.dimension.googleAds');
    if (l === 'seo' || l === 'organic') return t('common.dimension.seo');
    if (l === 'social') return t('common.dimension.social');
    if (l === 'direct') return t('common.dimension.direct');
    if (l === 'referral') return t('common.dimension.referral');
    if (l === 'other') return t('common.dimension.other');

    // Specific Attribution Models (Forensic)
    if (l === 'first click (paid)') return t('attribution.firstClickPaid');
    if (l.includes('first click')) return t('attribution.firstClick');
    if (l.includes('last click')) return t('attribution.lastClick');

    // Technical Events
    if (l.includes("whatsapp")) return t("event.whatsapp");
    if (l === "scroll_depth") return t("event.scrollDepth");
    if (l === "view") return t("event.view");
    if (l === "session_end") return t("event.sessionEnd");
    if (l === "page_unload") return t("event.pageUnload");

    return fixMojibake(raw);
}

function fixMojibake(s: string): string {
    if (!/[ÃÄÅ]/.test(s)) return s;
    try {
        const bytes = Uint8Array.from(s, (c) => c.charCodeAt(0));
        const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
        return decoded || s;
    } catch {
        return s;
    }
}
