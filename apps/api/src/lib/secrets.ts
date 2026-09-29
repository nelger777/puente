import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Secrets stored in the database (per-business AI keys) are sealed with AES-256-GCM under
 * SECRETS_KEY, which lives only in the server environment. Format: base64(iv | tag | data).
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(hexKey: string) {
    if (!/^[0-9a-f]{64}$/i.test(hexKey)) throw new Error("SECRETS_KEY must be 64 hex characters");
    this.key = Buffer.from(hexKey, "hex");
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
  }

  open(sealed: string): string {
    const raw = Buffer.from(sealed, "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  }
}
