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
    telco_carrier: string | null;
}

export interface DeviceInfo {
    device_type: string;
    os: string;
    browser: string;
    browser_version: string | undefined;
    // Hardware DNA
    browser_language: string | null;
    device_memory: number | null;
    hardware_concurrency: number | null;
    screen_width: number | null;
    screen_height: number | null;
    pixel_ratio: number | null;
    gpu_renderer: string | null;
}

export interface GeoExtractionResult {
    geoInfo: GeoInfo;
    deviceInfo: DeviceInfo;
}

/**
 * Extract geographic and device information from request headers and metadata.
 * 
 * Priority for geo:
 * - Metadata override > Vercel headers > Cloudflare headers > Generic headers > Unknown
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
        // Hardware DNA from meta
        browser_language: meta?.lan || null,
        device_memory: meta?.mem ? parseInt(meta.mem) : null,
        hardware_concurrency: meta?.con ? parseInt(meta.con) : null,
        screen_width: meta?.sw ? parseInt(meta.sw) : null,
        screen_height: meta?.sh ? parseInt(meta.sh) : null,
        pixel_ratio: meta?.dpr ? parseFloat(meta.dpr) : null,
        gpu_renderer: meta?.gpu || null,
    };

    // Geo extraction from headers (Edge Runtime compatible)
    // Priority: Metadata override > Vercel > Cloudflare > Generic > Unknown
    // Vercel headers (x-vercel-ip-*) are added by Vercel Edge Network
    const cityFromVercel = req.headers.get('x-vercel-ip-city');
    const countryFromVercel = req.headers.get('x-vercel-ip-country');

    // Cloudflare headers (cf-ipcity, cf-ipdistrict) - if behind Cloudflare
    const cityFromCloudflare = req.headers.get('cf-ipcity');
    const districtFromCloudflare = req.headers.get('cf-ipdistrict');
    const countryFromCloudflare = req.headers.get('cf-ipcountry');

    // Generic headers (x-city, x-district) - fallback
    const cityFromGeneric = req.headers.get('x-city') ||
        req.headers.get('x-forwarded-city');
    const districtFromGeneric = req.headers.get('x-district');
    const countryFromGeneric = req.headers.get('x-country');

    // Priority: Metadata override > Vercel > Cloudflare > Generic > null
    const city = meta?.city ||
        cityFromVercel ||
        cityFromCloudflare ||
        cityFromGeneric ||
        null;

    // District: Metadata override > Cloudflare > Generic > null
    // Note: x-vercel-ip-country-region is region/province, not district - do not use
    const district = meta?.district ||
        districtFromCloudflare ||
        districtFromGeneric ||
        null;

    // Country: Vercel > Cloudflare > Generic > Unknown
    const country = countryFromVercel ||
        countryFromCloudflare ||
        countryFromGeneric ||
        'Unknown';

    const geoInfo: GeoInfo = {
        city: city || 'Unknown',
        district: district,
        country: country,
        timezone: req.headers.get('cf-timezone') ||
            req.headers.get('x-timezone') ||
            'Unknown',
        telco_carrier: req.headers.get('cf-as-organization') ||
            req.headers.get('x-isp') ||
            req.headers.get('x-operator') ||
            null,
    };

    return {
        geoInfo,
        deviceInfo,
    };
}
