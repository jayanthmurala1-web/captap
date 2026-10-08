import { expect, test } from "vitest";
import { ValidationError } from "../errors";
import { validatePrdStructure } from "./validator";

const longEnough = (words: number) => Array(words).fill("word").join(" ");

const validPrd = `
## Problem & Context
${longEnough(55)}

## Non-Goals
- Not doing mobile apps
- Not doing SSO in v1

## Acceptance Criteria
- Given a user signs up, when they confirm email, then account is active.
`;

test("rejects a PRD missing all required sections", () => {
  expect(() => validatePrdStructure("# Just a title\nsome text")).toThrow(
    ValidationError,
  );
  try {
    validatePrdStructure("# Just a title\nsome text");
  } catch (e) {
    const msg = (e as Error).message;
    expect(msg).toMatch(/Problem/i);
    expect(msg).toMatch(/Non-Goals/i);
    expect(msg).toMatch(/Acceptance Criteria/i);
  }
});

test("rejects a Problem section under 50 words", () => {
  const content = validPrd.replace(longEnough(55), longEnough(10));
  expect(() => validatePrdStructure(content)).toThrow(/Problem/i);
});

test("rejects a Non-Goals section with only 1 item", () => {
  const content = validPrd.replace(
    "- Not doing mobile apps\n- Not doing SSO in v1",
    "- Not doing mobile apps",
  );
  expect(() => validatePrdStructure(content)).toThrow(/Non-Goals/i);
});

test("rejects an Acceptance Criteria heading with an empty body", () => {
  const content = validPrd.replace(
    "- Given a user signs up, when they confirm email, then account is active.",
    "",
  );
  expect(() => validatePrdStructure(content)).toThrow(/Acceptance Criteria/i);
});

test("accepts a PRD satisfying all three rules", () => {
  expect(() => validatePrdStructure(validPrd)).not.toThrow();
});

test("matches section headers case-insensitively and accepts naming variants", () => {
  const content = `
## problem
${longEnough(55)}

## Explicit Non-Goals
- one
- two

## Verifiable Acceptance Criteria
- Given/when/then here
`;
  expect(() => validatePrdStructure(content)).not.toThrow();
});
