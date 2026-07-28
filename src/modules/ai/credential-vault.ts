import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncryptedCredential = Readonly<{
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
  maskedSuffix: string;
}>;
function decodeMasterKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, "base64");
  if (key.byteLength !== 32) throw new Error("Credential encryption is unavailable.");
  return key;
}
export function encryptCredential(
  plaintext: string,
  encodedMasterKey: string,
  keyVersion = 1
): EncryptedCredential {
  if (plaintext.trim().length < 12) throw new Error("Credential is invalid.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", decodeMasterKey(encodedMasterKey), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Object.freeze({
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion,
    maskedSuffix: plaintext.slice(-4)
  });
}
export function decryptCredential(
  envelope: Pick<EncryptedCredential, "ciphertext" | "iv" | "authTag">,
  encodedMasterKey: string
): string {
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      decodeMasterKey(encodedMasterKey),
      Buffer.from(envelope.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    throw new Error("Credential decryption failed.");
  }
}
