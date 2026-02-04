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
        const stripped = trimmed.replace(/-/g, '');
        const is32Hex = /^[0-9a-f]{32}$/i.test(stripped);

        // 32-char hex: client may send UUID without hyphens OR public_id that looks like hex.
        // Try by id first (normalized UUID), then by public_id, so both cases resolve.
        if (is32Hex) {
            const normalizedUuid =
                stripped.substring(0, 8) + '-' +
                stripped.substring(8, 12) + '-' +
                stripped.substring(12, 16) + '-' +
                stripped.substring(16, 20) + '-' +
                stripped.substring(20, 32);
            debugLog('[SYNC_DB] Searching site (32hex): try id then public_id', { normalizedUuid, trimmed });
            const byId = await adminClient
                .from('sites')
                .select('id')
                .eq('id', normalizedUuid)
                .maybeSingle();
            if (byId.error) {
                console.error('[SYNC_ERROR] Site query error:', siteId, byId.error?.message, byId.error?.code);
                return { valid: false, error: 'Site validation failed' };
            }
            if (byId.data) return { valid: true, site: byId.data };
            const byPublicId = await adminClient
                .from('sites')
                .select('id')
                .eq('public_id', trimmed)
                .maybeSingle();
            if (byPublicId.error) {
                console.error('[SYNC_ERROR] Site query error:', siteId, byPublicId.error?.message, byPublicId.error?.code);
                return { valid: false, error: 'Site validation failed' };
            }
            if (byPublicId.data) return { valid: true, site: byPublicId.data };
            console.error('[SYNC_ERROR] Site not found:', siteId);
            return { valid: false, error: 'Site not found' };
        }

        // Non-32hex: treat as public_id (e.g. test_site_abc)
        debugLog('[SYNC_DB] Searching site by public_id:', { idValue: trimmed });
        const { data: site, error: siteError } = await adminClient
            .from('sites')
            .select('id')
            .eq('public_id', trimmed)
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
