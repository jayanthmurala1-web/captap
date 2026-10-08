import { MarkdownManager } from "@tiptap/markdown";
import { expect, test } from "vitest";
import { validatePrdStructure } from "@/lib/documents/validator";
import { validPrd } from "@/lib/test-fixtures";
import { contentExtensions } from "./extensions";
import { tidyMarkdown } from "./markdown";

// Documents are edited as rich text but stored as markdown. If the round trip
// drops structure, the PRD linter and drift check break — so pin it.
const md = new MarkdownManager({ extensions: contentExtensions });
const roundTrip = (s: string) => tidyMarkdown(md.serialize(md.parse(s)));

test("a valid PRD is still a valid PRD after passing through the editor", () => {
  const out = roundTrip(validPrd);
  expect(() => validatePrdStructure(out)).not.toThrow();
  expect(out).toContain("## Problem & Context");
  expect(out).toContain("## Non-Goals");
});

test("tables, images, checklists and emphasis survive", () => {
  const src = [
    "## Plan",
    "",
    "| Field | Type |",
    "| --- | --- |",
    "| id | uuid |",
    "| email | text |",
    "",
    "![Checkout mockup](https://res.cloudinary.com/demo/image/upload/v1/checkout.png)",
    "",
    "- [x] Stripe intent",
    "- [ ] Apple Pay",
    "",
    "Refunds are **required** at launch, *not* later.",
  ].join("\n");
  const out = roundTrip(src);
  expect(out).toMatch(/\|\s*Field\s*\|\s*Type\s*\|/);
  expect(out).toMatch(/\|\s*email\s*\|\s*text\s*\|/);
  expect(out).toContain(
    "![Checkout mockup](https://res.cloudinary.com/demo/image/upload/v1/checkout.png)",
  );
  expect(out).toMatch(/- \[x\] Stripe intent/);
  expect(out).toMatch(/- \[ \] Apple Pay/);
  expect(out).toContain("**required**");
  expect(roundTrip(out)).toBe(out); // stable: saving twice changes nothing
});

test("ampersands stay readable, and typed entity text still round-trips", () => {
  expect(roundTrip("## Problem & Context")).toContain("## Problem & Context");
  // Source "&amp;" means "&"; a person literally typing "&amp;" is stored as "&amp;amp;".
  expect(roundTrip("Terms &amp; conditions")).toContain("Terms & conditions");
  expect(roundTrip("Escape it as &amp;amp; in HTML")).toContain("&amp;amp;");
  expect(roundTrip("Use <b> tags? a < b")).not.toMatch(/<b>/);
});
