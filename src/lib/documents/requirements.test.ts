import { expect, test } from "vitest";
import { numberRequirements } from "./requirements";

const prd = (criteria: string, extra = "") => `## Problem & Context
Some problem.

## Non-Goals
- Not mobile
- Not SSO

## Acceptance Criteria
${criteria}
${extra}`;

test("unmarked acceptance bullets get sequential keys written into the text", () => {
  const r = numberRequirements(
    prd("- Customer can pay by card\n- Customer gets a receipt"),
    0,
  );
  expect(r.items).toEqual([
    { key: "R-1", text: "Customer can pay by card" },
    { key: "R-2", text: "Customer gets a receipt" },
  ]);
  expect(r.content).toContain("- R-1: Customer can pay by card");
  expect(r.content).toContain("- R-2: Customer gets a receipt");
  expect(r.content).toContain("- Not mobile"); // other sections untouched
});

test("existing keys are kept through reordering and rewording; new bullets never reuse a key", () => {
  const r = numberRequirements(
    prd(
      "- R-2: Receipt is emailed within a minute\n- Refunds work\n- R-1: Pay by card or wallet",
    ),
    5, // R-3..R-5 were used before and later deleted
  );
  expect(r.items.map((i) => i.key)).toEqual(["R-2", "R-6", "R-1"]);
  expect(r.items[0].text).toBe("Receipt is emailed within a minute");
  expect(r.content).toContain("- R-6: Refunds work");
});

test("a duplicated key (copy-paste) is renumbered rather than shared", () => {
  const r = numberRequirements(prd("- R-1: One\n- R-1: One again"), 1);
  expect(r.items.map((i) => i.key)).toEqual(["R-1", "R-2"]);
});

test("only top-level bullets of the Acceptance section count; checklists and numbered lists do", () => {
  const r = numberRequirements(
    prd(
      "- [ ] Checklist item\n  - nested detail is not a requirement\n1. Numbered item\n\nplain sentence",
      "\n## Later section\n- Not a requirement",
    ),
    0,
  );
  expect(r.items).toEqual([
    { key: "R-1", text: "Checklist item" },
    { key: "R-2", text: "Numbered item" },
  ]);
  expect(r.content).toContain("- [ ] R-1: Checklist item");
  expect(r.content).toContain("1. R-2: Numbered item");
  expect(r.content).toContain("- Not a requirement");
});

test("numbering is idempotent and a doc without criteria yields nothing", () => {
  const once = numberRequirements(prd("- A\n- B"), 0);
  const twice = numberRequirements(once.content, 2);
  expect(twice.content).toBe(once.content);
  expect(twice.items).toEqual(once.items);
  expect(numberRequirements("## Notes\n- x", 0)).toEqual({
    content: "## Notes\n- x",
    items: [],
  });
});
