import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

// Application-layer encryption for OAuth tokens at rest (Database Design
// Document §4.3's `access_token_encrypted`/`refresh_token_encrypted`
// columns). AES-256-GCM keyed from TOKEN_ENCRYPTION_KEY via scrypt (so any
// passphrase-shaped string works as the env var, not just a raw 32-byte
// hex key) — the local, self-hosted-Postgres equivalent of the AWS
// KMS-backed envelope encryption a production deployment would use
// (Architecture Document §7). Ciphertext layout is `salt(16) | iv(12) |
// authTag(16) | ciphertext`, all in one Buffer so it fits the schema's
// single `Bytes` column.
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, 32);
}

export function encryptToken(plainText: string, secret: string): Buffer {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = deriveKey(secret, salt);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([salt, iv, authTag, ciphertext]);
}

export function decryptToken(encrypted: Buffer, secret: string): string {
  const salt = encrypted.subarray(0, SALT_LENGTH);
  const iv = encrypted.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = encrypted.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = encrypted.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

  const key = deriveKey(secret, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
