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
    /** ASN from edge (e.g. cf-connecting-ip-asn, x-asn). Set only when req is available (producer). */
    isp_asn: string | null;
    /** Heuristic: multiple IPs in x-forwarded-for or cf-visitor. Set only when req is available (producer). */
    is_proxy_detected: boolean;
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
 * Priority for geo (when behind Cloudflare, prefer CF so visitor IP is used, not edge):
 * - Metadata override > Cloudflare headers > Vercel headers > Generic headers > Unknown
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
    req: NextRequest | null,
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
    // Priority: Metadata override > Cloudflare > Vercel > Generic > Unknown (CF first = visitor IP, not edge)
    const cityFromCloudflare = req?.headers.get('cf-ipcity');
    const districtFromCloudflare = req?.headers.get('cf-ipdistrict');
    const countryFromCloudflare = req?.headers.get('cf-ipcountry');

    const cityFromVercel = req?.headers.get('x-vercel-ip-city');
    const countryFromVercel = req?.headers.get('x-vercel-ip-country');

    const cityFromGeneric = req?.headers.get('x-city') ||
        req?.headers.get('x-forwarded-city');
    const districtFromGeneric = req?.headers.get('x-district');
    const countryFromGeneric = req?.headers.get('x-country');

    const city = meta?.city ||
        cityFromCloudflare ||
        cityFromVercel ||
        cityFromGeneric ||
        null;

    const district = meta?.district ||
        districtFromCloudflare ||
        districtFromGeneric ||
        null;

    const country = countryFromCloudflare ||
        countryFromVercel ||
        countryFromGeneric ||
        'Unknown';

    // isp_asn: Cloudflare/Vercel or custom header (producer only; worker has no client req)
    const ispAsn = req?.headers.get('cf-connecting-ip-asn') ??
        req?.headers.get('x-vercel-ip-asn') ??
        req?.headers.get('x-asn') ?? null;
    // is_proxy_detected: multiple IPs in x-forwarded-for or cf-visitor indicates proxy
    const forwarded = req?.headers.get('x-forwarded-for') ?? '';
    const proxyDetected = forwarded ? forwarded.split(',').length > 1 : false;

    const geoInfo: GeoInfo = {
        city: city || 'Unknown',
        district: district,
        country: country,
        timezone: req?.headers.get('cf-timezone') ||
            req?.headers.get('x-timezone') ||
            'Unknown',
        telco_carrier: req?.headers.get('cf-as-organization') ||
            req?.headers.get('x-isp') ||
            req?.headers.get('x-operator') ||
            null,
        isp_asn: ispAsn,
        is_proxy_detected: proxyDetected,
    };

    return {
        geoInfo,
        deviceInfo,
    };
}
