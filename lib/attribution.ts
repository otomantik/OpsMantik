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
    term?: string;
    content?: string;
    matchtype?: string; // Google Ads: e=Exact, p=Phrase, b=Broad
    device?: string;   // Google Ads {device}: mobile, desktop, tablet
    network?: string;  // Google Ads {network}: Search, Display, YouTube, etc.
    placement?: string; // Google Ads {placement}
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
 * Extract UTM and Google Ads params from URL
 * Supports: utm_*, matchtype, device, network, placement (hesaptan şablon)
 * ROBUST: Also parses fragment-based query strings (e.g., #?utm_term=keyword)
 */
export function extractUTM(url: string): AttributionInput['utm'] | null {
  try {
    const urlObj = new URL(url);
    let params = new URLSearchParams(urlObj.search);

    // ROBUST: Parse fragment (#) if it contains query params (Google Ads redirect bug)
    // Example: https://domain.com/?gclid=xxx#4?utm_source=google&utm_term=keyword
    if (urlObj.hash && urlObj.hash.includes('?')) {
      const fragmentQuery = urlObj.hash.split('?')[1];
      if (fragmentQuery) {
        const fragmentParams = new URLSearchParams(fragmentQuery);
        // Merge fragment params into main params (fragment values take precedence if duplicate)
        fragmentParams.forEach((value, key) => {
          params.set(key, value);
        });
      }
    }

    const medium = params.get('utm_medium');
    const source = params.get('utm_source');
    const campaign = params.get('utm_campaign');
    const term = params.get('utm_term');
    const content = params.get('utm_content');
    const matchtype = params.get('matchtype'); // e, p, b
    const device = params.get('device');   // Google Ads {device}
    const network = params.get('network'); // Google Ads {network}
    const placement = params.get('placement'); // Google Ads {placement}

    if (!medium && !source && !campaign && !term && !content && !matchtype && !device && !network && !placement) {
      return null;
    }

    return {
      medium: medium || undefined,
      source: source || undefined,
      campaign: campaign || undefined,
      term: term || undefined,
      content: content || undefined,
      matchtype: matchtype || undefined,
      device: device || undefined,
      network: network || undefined,
      placement: placement || undefined,
    };
  } catch {
    return null;
  }
}
