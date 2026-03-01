/**
 * OpsMantik Canonical Conversion Names
 *
 * Exact names sent to Google Ads. Single source of truth.
 * V1_Nabiz = PageView observation; V2_Ilk_Temas = Pulse (call/form); etc.
 */

import type { OpsGear } from './types';

export const OPSMANTIK_CONVERSION_NAMES: Record<OpsGear, string> = {
  V1_PAGEVIEW: 'OpsMantik_V1_Nabiz',
  V2_PULSE: 'OpsMantik_V2_Ilk_Temas',
  V3_ENGAGE: 'OpsMantik_V3_Nitelikli_Gorusme',
  V4_INTENT: 'OpsMantik_V4_Sicak_Teklif',
  V5_SEAL: 'OpsMantik_V5_DEMIR_MUHUR',
};
