import { adminClient } from '@/lib/supabase/admin';
import { debugLog } from '@/lib/utils';

export class SiteService {
    /**
     * Validate site ID and check existence in DB.
     * Supports: (1) UUID v4 (with or without hyphens), (2) public_id (e.g. test_site_abc12345).
     */
    static async validateSite(siteId: string) {
        if (typeof siteId !== 'string' || !siteId.trim()) {
            return { valid: false, error: 'Invalid site_id format' };
        }
        const trimmed = siteId.trim();

        const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        const stripped = trimmed.replace(/-/g, '');
        const looksLikeUuid = /^[0-9a-f]{32}$/i.test(stripped);

        let searchBy: 'id' | 'public_id' = 'public_id';
        let idValue: string = trimmed;

        if (looksLikeUuid) {
            const normalizedUuid =
                stripped.substring(0, 8) + '-' +
                stripped.substring(8, 12) + '-' +
                stripped.substring(12, 16) + '-' +
                stripped.substring(16, 20) + '-' +
                stripped.substring(20, 32);
            if (uuidV4Regex.test(normalizedUuid)) {
                searchBy = 'id';
                idValue = normalizedUuid;
            }
        }

        debugLog('[SYNC_DB] Searching site:', { searchBy, idValue });

        const { data: site, error: siteError } = await adminClient
            .from('sites')
            .select('id')
            .eq(searchBy === 'id' ? 'id' : 'public_id', idValue)
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
