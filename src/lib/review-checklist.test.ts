import { expect, test } from "vitest";
import type { ReviewResult } from "@/db/schema";
import { reviewChecklist } from "./review-checklist";

const base = {
  verificationStatus: "verified",
  verificationDetails: {
    commitExists: true,
    ciStatus: "success" as const,
    verifiedAt: "",
  },
  tests: [{ command: "pnpm test", exitCode: 0, summary: "ok" }],
  reviews: [
    { skill: "security", status: "PASS", summary: "" },
    { skill: "requirement-drift", status: "PASS", summary: "" },
  ] as ReviewResult[],
};
const byId = (c: ReturnType<typeof reviewChecklist>) =>
  Object.fromEntries(c.items.map((i) => [i.id, i.state]));

test("all checks passing → ready", () => {
  const c = reviewChecklist(base, { prdLinked: true });
  expect(c.verdict).toBe("ready");
  expect(Object.values(byId(c)).every((s) => s === "pass")).toBe(true);
});

test("agent-reported only (not GitHub-verified) is pending, not a pass", () => {
  const c = reviewChecklist(
    { ...base, verificationStatus: "unverified", verificationDetails: null },
    { prdLinked: true },
  );
  expect(byId(c).github).toBe("pending");
  expect(byId(c).ci).toBe("pending");
  expect(c.verdict).toBe("incomplete");
});

test("any failure wins over pending", () => {
  const c = reviewChecklist(
    {
      ...base,
      verificationStatus: "unverified",
      tests: [{ command: "pnpm test", exitCode: 1, summary: "2 failed" }],
    },
    { prdLinked: true },
  );
  expect(byId(c).tests).toBe("fail");
  expect(c.verdict).toBe("issues");
});

test("drift: FAIL or NEEDS_WORK fails; no PRD linked is n/a (doesn't block); not run is pending", () => {
  const drift = (status: ReviewResult["status"]) =>
    byId(
      reviewChecklist(
        {
          ...base,
          reviews: [
            base.reviews[0],
            { skill: "requirement-drift", status, summary: "" },
          ],
        },
        { prdLinked: true },
      ),
    ).drift;
  expect(drift("FAIL")).toBe("fail");
  expect(drift("NEEDS_WORK")).toBe("fail");

  const noPrd = reviewChecklist(
    { ...base, reviews: [base.reviews[0]] },
    { prdLinked: false },
  );
  expect(byId(noPrd).drift).toBe("na");
  expect(noPrd.verdict).toBe("ready");

  const notRun = reviewChecklist(
    { ...base, reviews: [base.reviews[0]] },
    { prdLinked: true },
  );
  expect(byId(notRun).drift).toBe("pending");
});

test("persona reviews exclude drift; blocking or FAIL fails, none run is pending", () => {
  const onlyDrift = reviewChecklist(
    { ...base, reviews: [base.reviews[1]] },
    { prdLinked: true },
  );
  expect(byId(onlyDrift).reviews).toBe("pending");

  const blocking = reviewChecklist(
    {
      ...base,
      reviews: [
        {
          skill: "security",
          status: "NEEDS_WORK",
          summary: "",
          blocking: true,
        },
        base.reviews[1],
      ],
    },
    { prdLinked: true },
  );
  expect(byId(blocking).reviews).toBe("fail");

  const soft = reviewChecklist(
    {
      ...base,
      reviews: [
        { skill: "security", status: "NEEDS_WORK", summary: "" },
        base.reviews[1],
      ],
    },
    { prdLinked: true },
  );
  expect(byId(soft).reviews).toBe("warn");
  expect(soft.verdict).toBe("issues");
});

test("CI failure fails; no CI configured is n/a", () => {
  const fail = reviewChecklist(
    {
      ...base,
      verificationDetails: { ...base.verificationDetails, ciStatus: "failure" },
    },
    { prdLinked: true },
  );
  expect(byId(fail).ci).toBe("fail");
  const none = reviewChecklist(
    {
      ...base,
      verificationDetails: { ...base.verificationDetails, ciStatus: "none" },
    },
    { prdLinked: true },
  );
  expect(byId(none).ci).toBe("na");
});

test("when verification couldn't run, CI is unknown (not 'no CI') and the reason is shown", () => {
  const c = reviewChecklist(
    {
      ...base,
      verificationStatus: "unverified",
      verificationDetails: {
        commitExists: false,
        ciStatus: "none",
        verifiedAt: "",
        error: "No GitHub repository linked to this project.",
      },
    },
    { prdLinked: true },
  );
  const github = c.items.find((i) => i.id === "github");
  expect(github?.state).toBe("pending");
  expect(github?.detail).toBe("No GitHub repository linked to this project.");
  expect(byId(c).ci).toBe("pending");
});
