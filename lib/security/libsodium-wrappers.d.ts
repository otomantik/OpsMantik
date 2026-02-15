declare module 'libsodium-wrappers' {
  interface Sodium {
    ready: Promise<void>;
    crypto_box_seed_keypair(seed: Uint8Array): { publicKey: Uint8Array; privateKey: Uint8Array };
    crypto_box_seal(message: Uint8Array, publicKey: Uint8Array): Uint8Array;
    crypto_box_seal_open(ciphertext: Uint8Array, publicKey: Uint8Array, privateKey: Uint8Array): Uint8Array;
    from_base64(s: string, variant: number): Uint8Array;
    to_base64(b: Uint8Array, variant: number): string;
    base64_variants: { ORIGINAL: number };
  }
  const sodium: Sodium;
  export default sodium;
}
