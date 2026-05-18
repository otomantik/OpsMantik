/** Stable machine keys for Source Truth v2. */

export const REASON = {
  GOOGLE_SRSLTID_ORGANIC_SHOPPING: 'google_srsltid_organic_shopping',
  FRAUD_POISONED_CLICK_ID: 'fraud_poisoned_click_id',
  GOOGLE_GCLID_VALID: 'google_gclid_valid',
  GOOGLE_WBRAID_VALID: 'google_wbraid_valid',
  GOOGLE_GBRAID_VALID: 'google_gbraid_valid',
  PAID_CLICK_ID_OVER_UTM: 'paid_click_id_over_utm',
  MAPS_REFERRER: 'maps_referrer',
  AI_REFERRER: 'ai_referrer',
  UA_IN_APP_BROWSER: 'ua_in_app_browser',
  TEMPORAL_DARK_RETURN: 'temporal_dark_return',
  UTM_PAID_SOCIAL: 'utm_paid_social',
  UTM_DARK_SOCIAL: 'utm_dark_social',
  ORGANIC_SEARCH_REFERRER: 'organic_search_referrer',
  ORGANIC_SOCIAL_REFERRER: 'organic_social_referrer',
  EMAIL_UTM: 'email_utm',
  REFERRAL_HOST: 'referral_host',
  DIRECT_NO_SIGNALS: 'direct_no_signals',
  TAGGED_UNKNOWN: 'tagged_unknown',
} as const;

export const CONTRADICTION = {
  UTM_CONTRADICTS_CLICK_ID: 'UTM_CONTRADICTS_CLICK_ID',
} as const;

export type ReasonCode = (typeof REASON)[keyof typeof REASON];
export type ContradictionCode = (typeof CONTRADICTION)[keyof typeof CONTRADICTION];
