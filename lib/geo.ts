/**
 * Geo Extraction Module
 * 
 * Extracts geographic and device information from request headers and metadata.
 * Extracted from app/api/sync/route.ts for canonical single source of truth.
 * 
 * Edge Runtime compatible (no Node.js-specific dependencies).
 */

import { NextRequest } from 'next/server';
import { UAParser } from 'ua-parser-js';

export interface GeoInfo {
    city: string;
    district: string | null;
    country: string;
    timezone: string;
}

export interface DeviceInfo {
    device_type: string;
    os: string;
    browser: string;
    browser_version: string | undefined;
}

export interface GeoExtractionResult {
    geoInfo: GeoInfo;
    deviceInfo: DeviceInfo;
}

/**
 * Extract geographic and device information from request headers and metadata.
 * 
 * Priority for geo:
 * - Metadata override > Server headers > Unknown
 * 
 * Device type normalization:
 * - mobile/tablet/desktop (default: desktop)
 * 
 * @param req - Next.js request object
 * @param userAgent - User agent string
 * @param meta - Optional metadata object with city/district overrides
 * @returns GeoInfo and DeviceInfo
 */
export function extractGeoInfo(
    req: NextRequest,
    userAgent: string,
    meta?: any
): GeoExtractionResult {
    // Device & Geo Enrichment
    const parser = new UAParser(userAgent);
    
    // Normalize device_type to desktop/mobile/tablet
    const rawDeviceType = parser.getDevice().type;
    let deviceType = 'desktop'; // default
    if (rawDeviceType === 'mobile') {
        deviceType = 'mobile';
    } else if (rawDeviceType === 'tablet') {
        deviceType = 'tablet';
    } else {
        // Fallback: check user agent for mobile/tablet patterns
        const uaLower = userAgent.toLowerCase();
        if (uaLower.includes('mobile') || uaLower.includes('android') || uaLower.includes('iphone')) {
            deviceType = 'mobile';
        } else if (uaLower.includes('tablet') || uaLower.includes('ipad')) {
            deviceType = 'tablet';
        }
    }
    
    const deviceInfo: DeviceInfo = {
        device_type: deviceType,
        os: parser.getOS().name || 'Unknown',
        browser: parser.getBrowser().name || 'Unknown',
        browser_version: parser.getBrowser().version,
    };

    // Geo extraction from headers (Edge Runtime compatible)
    // Priority: CF-IPCity (Cloudflare) > X-City > fallback
    const cityFromHeader = req.headers.get('cf-ipcity') || 
                           req.headers.get('x-city') || 
                           req.headers.get('x-forwarded-city') ||
                           null;
    
    const districtFromHeader = req.headers.get('cf-ipdistrict') ||
                              req.headers.get('x-district') ||
                              null;
    
    // Priority: Metadata override > Server headers > Unknown
    const city = meta?.city || cityFromHeader || null;
    const district = meta?.district || districtFromHeader || null;
    
    const geoInfo: GeoInfo = {
        city: city || 'Unknown',
        district: district,
        country: req.headers.get('cf-ipcountry') || 
                 req.headers.get('x-country') || 
                 'Unknown',
        timezone: req.headers.get('cf-timezone') || 
                 req.headers.get('x-timezone') || 
                 'Unknown',
    };

    return {
        geoInfo,
        deviceInfo,
    };
}
