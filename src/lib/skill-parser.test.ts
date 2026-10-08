import { expect, test } from "vitest";
import {
  composeSkill,
  parseSkill,
  SkillParseError,
  splitSkill,
} from "./skill-parser";

const skill = (fm: string, body = "Do the thing.") =>
  `---\n${fm}\n---\n${body}`;

test("accepts a valid skill and normalizes CRLF + BOM", () => {
  const out = parseSkill(
    `﻿${skill("name: code-review\ndescription: Reviews code.")}`.replace(
      /\n/g,
      "\r\n",
    ),
  );
  expect(out).toMatchObject({
    name: "code-review",
    description: "Reviews code.",
  });
  expect(out.source).not.toMatch(/\r|﻿/);
});

test.each([
  ["no frontmatter", "# just markdown"],
  ["uppercase name", skill("name: Code-Review\ndescription: x")],
  ["leading hyphen", skill("name: -review\ndescription: x")],
  ["double hyphen", skill("name: code--review\ndescription: x")],
  ["name too long", skill(`name: ${"a".repeat(65)}\ndescription: x`)],
  ["missing description", skill("name: review")],
  [
    "description too long",
    skill(`name: review\ndescription: ${"x".repeat(1025)}`),
  ],
  ["broken yaml", skill("name: [unclosed\ndescription: x")],
  ["too large", skill("name: big\ndescription: x", "x".repeat(100_001))],
])("rejects %s", (_, input) => {
  expect(() => parseSkill(input)).toThrow(SkillParseError);
});

test("an agent's playbook splits into fields + body and composes back, keeping other front-matter keys", () => {
  const src =
    "---\nname: payments-agent\ndescription: Payments specialist.\nlicense: MIT\n---\n\n# Instructions\nUse idempotency keys.\n";
  const parts = splitSkill(src);
  expect(parts).toMatchObject({
    name: "payments-agent",
    description: "Payments specialist.",
  });
  expect(parts.body.trim()).toBe("# Instructions\nUse idempotency keys.");

  const next = composeSkill(
    {
      name: "payments-agent",
      description: "Handles refunds too.",
      body: parts.body,
    },
    src,
  );
  const parsed = parseSkill(next);
  expect(parsed.description).toBe("Handles refunds too.");
  expect(next).toContain("license: MIT");
  expect(splitSkill(next).body.trim()).toBe(parts.body.trim());
});

test("composing a brand-new agent produces a valid SKILL.md; bad names are rejected", () => {
  expect(
    parseSkill(
      composeSkill({
        name: "qa-agent",
        description: "Checks work.",
        body: "Be strict.",
      }),
    ).name,
  ).toBe("qa-agent");
  expect(() =>
    parseSkill(composeSkill({ name: "QA Agent!", description: "x", body: "" })),
  ).toThrow();
});
