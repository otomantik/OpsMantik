/**
 * Runner credentials — decrypt provider_credentials payloads via the Vault module.
 * Extracted from lib/oci/runner.ts during Phase 4 god-object split.
 */

export async function decryptCredentials(ciphertext: string): Promise<unknown> {
  const vault = await import('@/lib/security/vault').catch(() => null);
  if (!vault?.decryptJson) throw new Error('Vault not configured');
  return vault.decryptJson(ciphertext);
}
