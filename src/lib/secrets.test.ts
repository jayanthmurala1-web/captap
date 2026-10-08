import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  SecretsUnavailableError,
  secretsConfigured,
} from "./secrets";

const original = process.env.SECRETS_ENCRYPTION_KEY;
beforeEach(() => {
  process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});
afterEach(() => {
  if (original === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
  else process.env.SECRETS_ENCRYPTION_KEY = original;
});

const KEY = "sk-live-abcdef1234567890";

test("round-trips, and the stored form never contains the plaintext", () => {
  const blob = encryptSecret(KEY, "org1:openai");
  expect(blob.startsWith("v1.")).toBe(true);
  expect(blob).not.toContain(KEY);
  expect(blob).not.toContain("abcdef1234567890");
  expect(decryptSecret(blob, "org1:openai")).toBe(KEY);
});

test("every encryption uses a fresh IV", () => {
  expect(encryptSecret(KEY, "a")).not.toBe(encryptSecret(KEY, "a"));
});

test("a tampered ciphertext fails to decrypt", () => {
  const [v, iv, tag, data] = encryptSecret(KEY, "a").split(".");
  const flipped = `${data.slice(0, -2)}${data.endsWith("AA") ? "BB" : "AA"}`;
  expect(() => decryptSecret([v, iv, tag, flipped].join("."), "a")).toThrow();
});

test("a ciphertext copied to another org or provider fails (bound by AAD)", () => {
  const blob = encryptSecret(KEY, "org1:openai");
  expect(() => decryptSecret(blob, "org2:openai")).toThrow();
  expect(() => decryptSecret(blob, "org1:anthropic")).toThrow();
});

test("a different encryption key cannot read it", () => {
  const blob = encryptSecret(KEY, "a");
  process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  expect(() => decryptSecret(blob, "a")).toThrow();
});

test("a missing or wrong-sized key disables the feature instead of storing plaintext", () => {
  delete process.env.SECRETS_ENCRYPTION_KEY;
  expect(secretsConfigured()).toBe(false);
  expect(() => encryptSecret(KEY, "a")).toThrow(SecretsUnavailableError);
  process.env.SECRETS_ENCRYPTION_KEY =
    Buffer.from("too short").toString("base64");
  expect(secretsConfigured()).toBe(false);
  expect(() => encryptSecret(KEY, "a")).toThrow(SecretsUnavailableError);
});
