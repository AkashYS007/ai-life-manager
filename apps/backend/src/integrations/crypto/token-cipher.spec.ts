import { encryptToken, decryptToken } from './token-cipher';

describe('token-cipher', () => {
  const secret = 'a-dev-only-passphrase-not-a-real-secret';

  it('round-trips a token through encrypt and decrypt', () => {
    const plain = 'ya29.a0Ael9example-google-access-token';
    const encrypted = encryptToken(plain, secret);
    expect(decryptToken(encrypted, secret)).toBe(plain);
  });

  it('never stores the plaintext token inside the ciphertext bytes', () => {
    const plain = 'super-secret-refresh-token-value';
    const encrypted = encryptToken(plain, secret);
    expect(encrypted.toString('utf8')).not.toContain(plain);
    expect(encrypted.toString('base64')).not.toContain(plain);
  });

  it('produces different ciphertext for the same input on every call (random IV/salt)', () => {
    const plain = 'same-token-twice';
    const first = encryptToken(plain, secret);
    const second = encryptToken(plain, secret);
    expect(first.equals(second)).toBe(false);
    expect(decryptToken(first, secret)).toBe(plain);
    expect(decryptToken(second, secret)).toBe(plain);
  });

  it('fails to decrypt with the wrong secret rather than returning garbage silently', () => {
    const encrypted = encryptToken('a-token', secret);
    expect(() => decryptToken(encrypted, 'wrong-secret')).toThrow();
  });

  it('fails to decrypt if the ciphertext bytes were tampered with', () => {
    const encrypted = encryptToken('a-token', secret);
    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 1] ^= 0xff; // flip the last ciphertext byte
    expect(() => decryptToken(tampered, secret)).toThrow();
  });
});
