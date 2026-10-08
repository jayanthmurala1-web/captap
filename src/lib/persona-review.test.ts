import { afterAll, beforeAll, describe, expect, it, test } from "vitest";
import { createDocument } from "./documents";
import { NotFoundError } from "./errors";
import { parseReviewJson, runPersonaReview } from "./persona-review";
import { createProject } from "./projects";
import { claimTask, createTasks, submitTask } from "./tasks";
import { fixtures } from "./test-fixtures";

describe("Persona Review Gate (Spec 008)", () => {
  it("parses clean structured JSON review output", () => {
    const json = JSON.stringify({
      status: "PASS",
      blocking: false,
      summary: "All acceptance criteria verified against diff.",
      criteriaChecks: [
        {
          criterion: "Given valid ID, returns 200",
          passed: true,
          evidence: "Added in src/lib/api.ts line 42",
        },
      ],
      findings: [
        {
          severity: "LOW",
          fileLine: "src/lib/api.ts:45",
          problem: "Typo in comment",
          fix: "Correct spelling",
        },
      ],
    });

    const parsed = parseReviewJson(json);
    expect(parsed.status).toBe("PASS");
    expect(parsed.blocking).toBe(false);
    expect(parsed.criteriaChecks).toHaveLength(1);
    expect(parsed.criteriaChecks[0].passed).toBe(true);
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0].severity).toBe("LOW");
  });

  it("handles markdown-fenced json output cleanly", () => {
    const fenced = `\`\`\`json
{
  "status": "FAIL",
  "blocking": true,
  "summary": "Critical security boundary violation detected.",
  "criteriaChecks": [
    { "criterion": "Tenant isolation", "passed": false, "evidence": "Missing orgId filter" }
  ],
  "findings": [
    { "severity": "CRITICAL", "problem": "No auth check on delete endpoint", "fix": "Add requireAdmin" }
  ]
}
\`\`\``;

    const parsed = parseReviewJson(fenced);
    expect(parsed.status).toBe("FAIL");
    expect(parsed.blocking).toBe(true);
    expect(parsed.criteriaChecks[0].passed).toBe(false);
    expect(parsed.findings[0].severity).toBe("CRITICAL");
  });

  it("falls back gracefully on malformed non-JSON output without throwing", () => {
    const raw = "The changes look mostly fine, but please check the test file.";
    const parsed = parseReviewJson(raw);
    expect(parsed.status).toBe("NEEDS_WORK");
    expect(parsed.blocking).toBe(false);
    expect(parsed.summary).toContain("The changes look mostly fine");
  });

  it("rejects non-existent task submission", async () => {
    await expect(
      runPersonaReview("user-1", "00000000-0000-0000-0000-000000000000"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("Requirement Drift Detection (Spec 012)", () => {
  const f = fixtures();
  let me: string;
  let projectId: string;

  const prdNamingStripe = `
## Problem & Context
${Array(55).fill("word").join(" ")}

## Non-Goals
- Not doing mobile apps
- Not doing SSO in v1

## Acceptance Criteria
- Given a customer checks out, when they pay, then Stripe processes the charge.
`;

  beforeAll(async () => {
    me = await f.user("drift-me");
    const org = await f.org("drift", { [me]: "owner" });
    projectId = (await createProject(me, org, { name: "Drift Co" })).id;
  });

  afterAll(() => f.cleanup());

  async function submitUnderPrd(prdDocumentId: string | null, summary: string) {
    const [t] = await createTasks(me, projectId, [
      {
        title: "Add checkout payment processing",
        role: "developer",
        prdDocumentId: prdDocumentId ?? undefined,
      },
    ]);
    await claimTask(me, t.id, "agent-1");
    const sub = await submitTask(me, t.id, "agent-1", {
      summary,
      filesChanged: ["src/lib/checkout.ts"],
      tests: [{ command: "pnpm test", exitCode: 0, summary: "pass" }],
    });
    return sub.submissionId;
  }

  test("no linked PRD: behaves exactly as before, no drift check applied", async () => {
    const submissionId = await submitUnderPrd(
      null,
      "Implemented checkout using PayPal.",
    );
    const key = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY; // this test only checks code-path selection, not real LLM output
    try {
      const results = await runPersonaReview(me, submissionId);
      expect(
        results.find((r) => r.skill === "requirement-drift"),
      ).toBeUndefined();
    } finally {
      if (key) process.env.GROQ_API_KEY = key;
    }
  });

  test("GROQ_API_KEY unset: degrades gracefully even with a linked PRD", async () => {
    const prd = await createDocument(me, projectId, {
      title: "PRD",
      kind: "prd",
      content: prdNamingStripe,
    });
    const submissionId = await submitUnderPrd(
      prd.id,
      "Implemented checkout using PayPal.",
    );
    const key = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    try {
      const results = await runPersonaReview(me, submissionId);
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(["PASS", "NEEDS_WORK", "FAIL"]).toContain(r.status);
      }
    } finally {
      if (key) process.env.GROQ_API_KEY = key;
    }
  });

  test.skipIf(!process.env.GROQ_API_KEY)(
    "flags a CRITICAL drift finding when the diff contradicts a named PRD decision",
    async () => {
      const prd = await createDocument(me, projectId, {
        title: "PRD",
        kind: "prd",
        content: prdNamingStripe,
      });
      const submissionId = await submitUnderPrd(
        prd.id,
        "Implemented checkout using PayPal instead of Stripe, since PayPal was easier to integrate.",
      );
      // Filtered to only the skill under test: running code-review/qa-review too on every
      // call was burning the shared Groq free-tier rate limit (8000 TPM) across repeated
      // test runs, which surfaced as the review silently degrading to a generic
      // "automated review error: 429..." NEEDS_WORK — not genuine model disagreement.
      const results = await runPersonaReview(
        me,
        submissionId,
        "requirement-drift",
      );
      const drift = results.find((r) => r.skill === "requirement-drift");
      expect(drift).toBeDefined();
      expect(drift?.status).toBe("FAIL");
      expect(drift?.blocking).toBe(true);
      expect(drift?.findings?.some((f) => f.severity === "CRITICAL")).toBe(
        true,
      );
      const text = JSON.stringify(drift).toLowerCase();
      expect(text).toMatch(/stripe/);
      expect(text).toMatch(/paypal/);
    },
    30_000,
  );

  test.skipIf(!process.env.GROQ_API_KEY)(
    "does not flag drift when the diff is consistent with the linked PRD",
    async () => {
      const prd = await createDocument(me, projectId, {
        title: "PRD",
        kind: "prd",
        content: prdNamingStripe,
      });
      const submissionId = await submitUnderPrd(
        prd.id,
        "Implemented checkout using Stripe's payment intents API as specified.",
      );
      const results = await runPersonaReview(
        me,
        submissionId,
        "requirement-drift",
      );
      const drift = results.find((r) => r.skill === "requirement-drift");
      expect(drift).toBeDefined();
      expect(drift?.status).toBe("PASS");
    },
    30_000,
  );
});
