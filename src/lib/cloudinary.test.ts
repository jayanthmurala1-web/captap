import { expect, test } from "vitest";
import { checkImage, signCloudinaryParams } from "./cloudinary";

test("signature matches Cloudinary's documented example", () => {
  // https://cloudinary.com/documentation/authentication_signatures
  expect(
    signCloudinaryParams(
      {
        timestamp: "1315060510",
        public_id: "sample_image",
        eager: "w_400,h_300,c_pad|w_260,h_200,c_crop",
      },
      "abcd",
    ),
  ).toBe("bfd09f95f331f558cbd1320e67aa8d488770583e");
});

test("only images, only up to the size cap", () => {
  const img = (type: string, size: number) => ({ type, size });
  expect(checkImage(img("image/png", 1_000))).toBeNull();
  expect(checkImage(img("image/webp", 1_000))).toBeNull();
  expect(checkImage(img("image/svg+xml", 1_000))).toMatch(
    /PNG, JPEG, GIF or WebP/,
  );
  expect(checkImage(img("application/pdf", 1_000))).toMatch(
    /PNG, JPEG, GIF or WebP/,
  );
  expect(checkImage(img("image/png", 11 * 1024 * 1024))).toMatch(/10 MB/);
});
