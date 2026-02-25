/**
 * Sprint 1.5 — Conversion Service
 *
 * Deterministic state machine that maps a (star, revenue, presignal_value)
 * tuple to the correct Google Ads action + adjustment value.
 *
 * Decision table:
 *  star ≤ 2              → RETRACT  (adjustment_value = 0)
 *  star = 5, revenue > 0 → SEND     (adjustment_value = revenue)
 *  star = 5, revenue = 0 → RESTATE  (adjustment_value = presignal_value)
 *  star 3–4              → SEND     (adjustment_value = revenue || presignal_value)
 */

export type GoogleAction = "SEND" | "RESTATE" | "RETRACT";

export interface DetermineResult {
    action: GoogleAction;
    adjustment_value: number;
}

/**
 * Determine the Google Ads conversion action and the value to send.
 *
 * @param star            - Conversion quality score (1–5)
 * @param revenue         - Actual confirmed revenue (0 if not yet confirmed)
 * @param presignal_value - Pre-signal / estimated value used when revenue is 0
 */
export function determineGoogleAction(
    star: number,
    revenue: number,
    presignal_value: number
): DetermineResult {
    // Low-quality signal → retract any previous conversion
    if (star <= 2) {
        return {
            action: "RETRACT",
            adjustment_value: 0,
        };
    }

    // Best case: confirmed revenue — send actual value
    if (star === 5 && revenue > 0) {
        return {
            action: "SEND",
            adjustment_value: revenue,
        };
    }

    // High quality but revenue not yet confirmed — restate with pre-signal
    if (star === 5 && revenue === 0) {
        return {
            action: "RESTATE",
            adjustment_value: presignal_value,
        };
    }

    // Mid-tier (3–4 stars): send best available value
    return {
        action: "SEND",
        adjustment_value: revenue > 0 ? revenue : presignal_value,
    };
}
