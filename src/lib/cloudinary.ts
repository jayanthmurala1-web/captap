import { createHash } from "node:crypto";
import { requireMember } from "./access";
import { ValidationError } from "./errors";

// SVG is excluded on purpose: it can carry script.
const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
const MAX_BYTES = 10 * 1024 * 1024;

/** Cloudinary's signature: sort params, join as k=v with &, append the secret, SHA-1. */
export function signCloudinaryParams(
  params: Record<string, string>,
  secret: string,
) {
  const payload = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash("sha1")
    .update(payload + secret)
    .digest("hex");
}

/** Null if the file is an acceptable image, otherwise the reason it isn't. */
export function checkImage(file: { type: string; size: number }) {
  if (!IMAGE_TYPES.has(file.type))
    return "Images must be PNG, JPEG, GIF or WebP.";
  if (file.size > MAX_BYTES) return "Images must be 10 MB or smaller.";
  return null;
}

function config() {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  const key = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;
  return cloud && key && secret ? { cloud, key, secret } : null;
}

export const imageUploadsConfigured = () => config() !== null;

/** Uploads an image for a workspace member and returns its https URL. */
export async function uploadImage(userId: string, orgId: string, file: File) {
  await requireMember(userId, orgId);
  const problem = checkImage(file);
  if (problem) throw new ValidationError(problem);
  const c = config();
  if (!c) {
    throw new ValidationError(
      "Image uploads aren't set up yet (Cloudinary keys missing in .env).",
    );
  }

  const params = {
    folder: `captap/${orgId}`,
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
  const body = new FormData();
  body.set("file", file);
  body.set("api_key", c.key);
  for (const [k, v] of Object.entries(params)) body.set(k, v);
  body.set("signature", signCloudinaryParams(params, c.secret));

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${c.cloud}/image/upload`,
    {
      method: "POST",
      body,
    },
  );
  const data = (await res.json().catch(() => ({}))) as {
    secure_url?: string;
    error?: { message?: string };
  };
  if (!res.ok || !data.secure_url) {
    throw new Error(
      `Image upload failed: ${data.error?.message ?? res.status}`,
    );
  }
  return data.secure_url;
}
