import { adminClient } from '@/lib/supabase/admin';
import { debugLog } from '@/lib/utils';

export class SiteService {
    /**
     * Validate site ID format and check existence in DB.
     * Supports UUID v4 with or without hyphens.
     */
    static async validateSite(siteId: string) {
        // 1. Normalize site_id format (UUID v4 - accept both hyphenated and non-hyphenated)
        let normalizedSiteId = siteId;
        if (typeof siteId === 'string') {
            // Remove existing hyphens
            const stripped = siteId.replace(/-/g, '');

            // Check if it's 32 hex characters (UUID without hyphens)
            if (/^[0-9a-f]{32}$/i.test(stripped)) {
                // Re-add hyphens in UUID v4 format: 8-4-4-4-12
                normalizedSiteId =
                    stripped.substring(0, 8) + '-' +
                    stripped.substring(8, 12) + '-' +
                    stripped.substring(12, 16) + '-' +
                    stripped.substring(16, 20) + '-' +
                    stripped.substring(20, 32);
            }
        }

        // Validate the normalized UUID v4 format
        const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (typeof normalizedSiteId !== 'string' || !uuidV4Regex.test(normalizedSiteId)) {
            return { valid: false, error: 'Invalid site_id format' };
        }

        const finalSiteId = normalizedSiteId;

        // Search for multiple formats: original, stripped, or hyphenated
        const strippedId = typeof siteId === 'string' ? siteId.replace(/-/g, '') : siteId;
        const searchIds = Array.from(new Set([siteId, finalSiteId, strippedId]));

        debugLog('[SYNC_DB] Searching site with IDs:', searchIds);

        const { data: site, error: siteError } = await adminClient
            .from('sites')
            .select('id')
            .in('public_id', searchIds)
            .maybeSingle();

        if (siteError) {
            console.error('[SYNC_ERROR] Site query error:', siteId, siteError?.message, siteError?.code);
            return { valid: false, error: 'Site validation failed' };
        }

        if (!site) {
            console.error('[SYNC_ERROR] Site not found:', siteId);
            return { valid: false, error: 'Site not found' };
        }

        return { valid: true, site };
    }
}
