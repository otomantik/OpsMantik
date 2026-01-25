/**
 * Attribution & Source Classification
 * 
 * Computes attribution source based on GCLID, UTM, referrer, and past session data.
 * Priority order: S1 (GCLID) > S2 (UTM) > S3 (Ads Assisted) > S4 (Paid Social) > S5 (Organic)
 */

export interface AttributionInput {
  gclid?: string | null;
  utm?: {
    medium?: string;
    source?: string;
    campaign?: string;
  } | null;
  referrer?: string | null;
  fingerprint?: string | null;
  hasPastGclid?: boolean; // Whether past session had GCLID
}

export interface AttributionResult {
  source: string;
  isPaid: boolean;
}

/**
 * Compute attribution source based on input data
 * 
 * Priority order:
 * S1: GCLID present => "First Click (Paid)"
 * S2: UTM medium=cpc/ppc/paid => "Paid (UTM)"
 * S3: referrer contains google + past gclid => "Ads Assisted"
 * S4: referrer contains social domain => "Paid Social"
 * S5: else => "Organic"
 */
export function computeAttribution(input: AttributionInput): AttributionResult {
  const { gclid, utm, referrer, hasPastGclid } = input;

  // S1: First Click (Paid) - GCLID present
  if (gclid) {
    return {
      source: 'First Click (Paid)',
      isPaid: true,
    };
  }

  // S2: Paid (UTM) - UTM medium indicates paid
  if (utm?.medium) {
    const medium = utm.medium.toLowerCase();
    if (medium === 'cpc' || medium === 'ppc' || medium === 'paid') {
      return {
        source: 'Paid (UTM)',
        isPaid: true,
      };
    }
  }

  // S3: Ads Assisted - Google referrer + past GCLID
  if (referrer && hasPastGclid) {
    const refLower = referrer.toLowerCase();
    if (refLower.includes('google') || refLower.includes('googleads')) {
      return {
        source: 'Ads Assisted',
        isPaid: true,
      };
    }
  }

  // S4: Paid Social - Social media referrer
  if (referrer) {
    const refLower = referrer.toLowerCase();
    const socialDomains = ['facebook', 'instagram', 'linkedin', 'twitter', 'tiktok', 'x.com'];
    if (socialDomains.some(domain => refLower.includes(domain))) {
      return {
        source: 'Paid Social',
        isPaid: true,
      };
    }
  }

  // S5: Organic (default)
  return {
    source: 'Organic',
    isPaid: false,
  };
}

/**
 * Extract UTM parameters from URL
 */
export function extractUTM(url: string): AttributionInput['utm'] | null {
  try {
    const urlObj = new URL(url);
    const medium = urlObj.searchParams.get('utm_medium');
    const source = urlObj.searchParams.get('utm_source');
    const campaign = urlObj.searchParams.get('utm_campaign');

    if (!medium && !source && !campaign) {
      return null;
    }

    return {
      medium: medium || undefined,
      source: source || undefined,
      campaign: campaign || undefined,
    };
  } catch {
    return null;
  }
}
