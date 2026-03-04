/**
 * DIC (Deterministic Identity-to-Conversion) / Enhanced Conversions helpers.
 * E.164 normalization and UTF-8-only SHA256 hashing for Google EC pipeline.
 */

export { normalizeToE164 } from './e164';
export {
  sha256HexUtf8,
  sha256Base64Utf8,
  sha256Hex64,
  sanitizePhoneForHash,
  hashPhoneForEC,
  hashPhoneForECBase64,
} from './identity-hash';
