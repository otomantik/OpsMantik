/**
 * Iron Dome v2.1 - Layer 3: Scrubber (Defense in Depth)
 * 
 * Scrubs cross-site data to prevent accidental data leakage.
 * Redacts sensitive fields but keeps structure for debugging.
 * 
 * Security: Client-safe, can be used in both server and client components.
 */

/**
 * Interface for data that may contain site_id
 */
export interface SiteScrubbable {
  site_id?: string;
  session_id?: string;
  user_agent?: string;
  ip?: string;
  ip_address?: string;
  phone_number?: string;
  fingerprint?: string;
  [key: string]: unknown;
}

/**
 * Scrubs cross-site data by redacting sensitive fields.
 * 
 * @param data - Single object or array of objects to scrub
 * @param expectedSiteId - The site_id that should match
 * @returns Scrubbed data with sensitive fields redacted if site_id mismatch
 */
export function scrubCrossSiteData<T extends SiteScrubbable>(
  data: T | T[],
  expectedSiteId: string
): T | T[] {
  const scrub = (item: T): T => {
    // If site_id exists and doesn't match expected, redact sensitive fields
    if (item.site_id && item.site_id !== expectedSiteId) {
      const scrubbed = { ...item };
      
      // Redact sensitive fields
      scrubbed.site_id = 'REDACTED' as T['site_id'];
      if (scrubbed.session_id) {
        scrubbed.session_id = 'REDACTED' as T['session_id'];
      }
      if (scrubbed.user_agent) {
        scrubbed.user_agent = 'REDACTED';
      }
      if (scrubbed.ip) {
        scrubbed.ip = 'REDACTED';
      }
      if (scrubbed.ip_address) {
        scrubbed.ip_address = 'REDACTED';
      }
      if (scrubbed.phone_number) {
        scrubbed.phone_number = 'REDACTED';
      }
      if (scrubbed.fingerprint) {
        scrubbed.fingerprint = 'REDACTED';
      }
      
      // Log security event (client-safe, uses console.warn)
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[SECURITY] Cross-site data detected and redacted', {
          expectedSiteId,
          detectedSiteId: item.site_id,
          timestamp: new Date().toISOString()
        });
      }
      
      return scrubbed as T;
    }
    
    return item;
  };
  
  return Array.isArray(data) 
    ? data.map(scrub) 
    : scrub(data);
}

/**
 * Validates that all items in an array belong to the expected site.
 * Returns filtered array with only matching items.
 * 
 * @param data - Array of objects to validate
 * @param expectedSiteId - The site_id that should match
 * @returns Filtered array with only items matching expectedSiteId
 */
export function filterBySiteId<T extends SiteScrubbable>(
  data: T[],
  expectedSiteId: string
): T[] {
  return data.filter(item => {
    if (!item.site_id) {
      return false; // Exclude items without site_id
    }
    
    if (item.site_id !== expectedSiteId) {
      // Log security event
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[SECURITY] Cross-site data filtered out', {
          expectedSiteId,
          detectedSiteId: item.site_id,
          timestamp: new Date().toISOString()
        });
      }
      return false;
    }
    
    return true;
  });
}

/**
 * Validates a single item's site_id matches expected.
 * 
 * @param item - Object to validate
 * @param expectedSiteId - The site_id that should match
 * @returns true if site_id matches or is undefined, false otherwise
 */
export function validateSiteId<T extends SiteScrubbable>(
  item: T,
  expectedSiteId: string
): boolean {
  if (!item.site_id) {
    return true; // Allow items without site_id (may be valid in some contexts)
  }
  
  if (item.site_id !== expectedSiteId) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[SECURITY] Site ID mismatch detected', {
        expectedSiteId,
        detectedSiteId: item.site_id,
        timestamp: new Date().toISOString()
      });
    }
    return false;
  }
  
  return true;
}
