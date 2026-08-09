import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

let cachedKey: Buffer | null = null;

/**
 * Derives a 32-byte key from VOX_ENCRYPTION_KEY. Accepts base64 or hex; falls
 * back to scrypt-stretching an arbitrary passphrase so local dev doesn't
 * require a perfectly-formatted key.
 */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.VOX_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "VOX_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and add it to .env."
    );
  }

  for (const encoding of ["base64", "hex"] as const) {
    const buf = Buffer.from(raw, encoding);
    if (buf.length === 32) {
      cachedKey = buf;
      return cachedKey;
    }
  }

  cachedKey = scryptSync(raw, "vox-encryption-salt", 32);
  return cachedKey;
}

/** Encrypts a UTF-8 string. Returns `iv:authTag:ciphertext`, all base64. */
export function encryptField(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(
    ":"
  );
}

/** Decrypts a string produced by {@link encryptField}. */
export function decryptField(encoded: string): string {
  const parts = encoded.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted field payload.");
  }
  const [ivB64, authTagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");

  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
