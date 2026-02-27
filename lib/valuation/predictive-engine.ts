/**
 * Predictive Value Engine - Mathematical Core
 * Calculates Expected Value (EV) for OCI based on intent stage.
 */

export interface IntentWeights {
    junk: number;
    pending: number;
    qualified: number;
    sealed: number;
    [key: string]: number;
}

export const DEFAULT_INTENT_WEIGHTS: IntentWeights = {
    junk: 0.0,
    pending: 0.02,
    qualified: 0.2,
    sealed: 1.0,
};

export const DEFAULT_AOV = 100.0;

/**
 * Calculates the Expected Value for a conversion.
 * Logic: AOV * Weight(Intent)
 * 
 * @param aov - Average Order Value (index)
 * @param weights - JSONB weights from sites table
 * @param intent - The intent stage (action) from the conversion queue
 */
export function calculateExpectedValue(
    aov: number | null | undefined,
    weights: any | null | undefined,
    intent: string | null | undefined
): number {
    const finalAov = (aov !== null && aov !== undefined && Number.isFinite(aov)) ? Number(aov) : DEFAULT_AOV;

    // Parse weights or use default
    let finalWeights = DEFAULT_INTENT_WEIGHTS;
    if (weights && typeof weights === 'object' && !Array.isArray(weights)) {
        finalWeights = { ...DEFAULT_INTENT_WEIGHTS, ...weights };
    }

    const stage = (intent || 'pending').toLowerCase();

    // Mapping logic as requested
    if (stage === 'sealed' || stage === 'won' || stage === 'purchase') {
        return finalAov * (finalWeights.sealed ?? DEFAULT_INTENT_WEIGHTS.sealed);
    }

    if (stage === 'qualified' || stage === 'real') {
        return finalAov * (finalWeights.qualified ?? DEFAULT_INTENT_WEIGHTS.qualified);
    }

    if (stage === 'pending' || stage === 'open') {
        return finalAov * (finalWeights.pending ?? DEFAULT_INTENT_WEIGHTS.pending);
    }

    if (stage === 'junk' || stage === 'lost') {
        return finalAov * (finalWeights.junk ?? DEFAULT_INTENT_WEIGHTS.junk);
    }

    // Fallback for unknown stages
    return 0;
}
