import { createHmac } from 'crypto';

/**
 * Minimal RFC 6238 TOTP generator, matching the backend's speakeasy
 * defaults (HMAC-SHA1, 6 digits, 30s step, base32 secret) — see
 * `authService.enableMFAFirstLogin`'s `speakeasy.totp.verify` call. No
 * runtime dependency needed at the e2e root (see issue #293): this is a
 * ~30-line HMAC-SHA1 implementation, not a library.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(base32: string): Buffer {
  const cleaned = base32.toUpperCase().replace(/=+$/, '');
  let bits = '';
  for (const char of cleaned) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value === -1) {
      throw new Error(`totp: invalid base32 character "${char}" in secret`);
    }
    bits += value.toString(2).padStart(5, '0');
  }

  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/**
 * Computes the current 6-digit TOTP code for a base32 secret, per
 * RFC 6238 (30s step, counter at Unix epoch / step).
 */
export function computeTotp(base32Secret: string, at: number = Date.now()): string {
  const key = base32Decode(base32Secret);
  const counter = Math.floor(at / 1000 / 30);

  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac('sha1', key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const truncated =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(truncated % 1_000_000).padStart(6, '0');
}
