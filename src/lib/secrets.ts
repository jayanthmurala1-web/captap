import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { DomainError } from "./errors";

/**
 * Encrypts small secrets (org-supplied LLM API keys, spec 021) with AES-256-GCM.
 * The key comes from SECRETS_ENCRYPTION_KEY (32 bytes, base64). Each secret gets a fresh IV and is
 * bound to `aad` (we pass "orgId:provider"), so a ciphertext copied to another row fails to decrypt.
 * Format: "v1.<iv>.<tag>.<data>", all base64url; the version prefix leaves room for rotation.
 */
export class SecretsUnavailableError extends DomainError {}

function key() {
  const raw = process.env.SECRETS_ENCRYPTION_KEY;
  const buf = raw ? Buffer.from(raw, "base64") : null;
  if (buf?.length !== 32)
    throw new SecretsUnavailableError(
      "Storing provider keys needs SECRETS_ENCRYPTION_KEY (32 bytes, base64) on the server: openssl rand -base64 32",
    );
  return buf;
}

export function secretsConfigured() {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plain: string, aad: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    data.toString("base64url"),
  ].join(".");
}

export function decryptSecret(blob: string, aad: string) {
  const [version, iv, tag, data] = blob.split(".");
  if (version !== "v1" || !iv || !tag || !data)
    throw new Error("Unrecognized secret format");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
