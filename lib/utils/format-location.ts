import { safeDecode } from '@/lib/utils/string-utils';

/**
 * Format Turkish administrative location consistently.
 *
 * Rules:
 * - district === "Merkez" => "${city} (Merkez)"
 * - district equals city => "${city}"
 * - otherwise => "${district} / ${city}"
 *
 * Defensive behavior:
 * - If only one side exists, return the non-empty one.
 * - If both are missing, return "—".
 */
export function formatLocation(city?: string | null, district?: string | null): string {
  const cityLabel = safeDecode((city || '').toString().trim());
  const districtLabel = safeDecode((district || '').toString().trim());

  const cityLc = cityLabel.toLowerCase();
  const districtLc = districtLabel.toLowerCase();

  if (!cityLabel && !districtLabel) return '—';

  if (districtLabel && districtLc === 'merkez') {
    return cityLabel ? `${cityLabel} (Merkez)` : 'Merkez';
  }

  if (cityLabel && districtLabel && cityLc === districtLc) {
    return cityLabel;
  }

  if (cityLabel && districtLabel) {
    return `${districtLabel} / ${cityLabel}`;
  }

  return cityLabel || districtLabel || '—';
}

