import type { ReviewResult, TestRun, VerificationDetails } from "@/db/schema";

export type CheckState = "pass" | "fail" | "warn" | "pending" | "na";
export type CheckItem = {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
};

const DRIFT_SKILL = "requirement-drift";

/** A review counts as blocking if it hard-failed or explicitly said so — the same definition the
 * task page's checklist uses, reused server-side (spec 024) so the gate matches what's shown. */
export function isBlockingReview(r: ReviewResult) {
  return r.status === "FAIL" || r.blocking === true;
}

/**
 * Turns one submission's evidence into the "should I approve this?" checklist on the task page.
 * Pure — the page decides nothing itself. Agent-reported data is never counted as a pass on its own.
 */
export function reviewChecklist(
  s: {
    verificationStatus: string;
    verificationDetails: VerificationDetails | null;
    tests: TestRun[];
    reviews: ReviewResult[];
  },
  opts: { prdLinked: boolean },
) {
  const items: CheckItem[] = [];
  const v = s.verificationDetails;

  items.push(
    s.verificationStatus === "verified"
      ? {
          id: "github",
          label: "Commit verified on GitHub",
          state: "pass",
          detail: v?.commitAuthor ? `by ${v.commitAuthor}` : "Commit exists",
        }
      : s.verificationStatus === "failed"
        ? {
            id: "github",
            label: "Commit verified on GitHub",
            state: "fail",
            detail: v?.error ?? "Verification failed",
          }
        : {
            id: "github",
            label: "Commit verified on GitHub",
            state: "pending",
            detail: v?.error ?? "Agent-reported only — not checked yet",
          },
  );

  const ci = v?.ciStatus;
  items.push(
    // CI is only knowable once GitHub has found the commit.
    !v?.commitExists
      ? {
          id: "ci",
          label: "CI",
          state: "pending",
          detail: "Unknown until the commit is verified",
        }
      : ci === "success"
        ? { id: "ci", label: "CI", state: "pass", detail: "All checks passed" }
        : ci === "failure"
          ? { id: "ci", label: "CI", state: "fail", detail: "Checks failed" }
          : ci === "pending"
            ? {
                id: "ci",
                label: "CI",
                state: "pending",
                detail: "Still running",
              }
            : {
                id: "ci",
                label: "CI",
                state: "na",
                detail: "No CI on this repo",
              },
  );

  const failing = s.tests.filter((t) => t.exitCode !== 0).length;
  items.push(
    s.tests.length === 0
      ? {
          id: "tests",
          label: "Tests reported by agent",
          state: "pending",
          detail: "None reported",
        }
      : failing
        ? {
            id: "tests",
            label: "Tests reported by agent",
            state: "fail",
            detail: `${failing} of ${s.tests.length} failing`,
          }
        : {
            id: "tests",
            label: "Tests reported by agent",
            state: "pass",
            detail: `${s.tests.length} passing`,
          },
  );

  const personas = s.reviews.filter((r) => r.skill !== DRIFT_SKILL);
  const hardFail = personas.filter(isBlockingReview);
  const soft = personas.filter((r) => r.status === "NEEDS_WORK" && !r.blocking);
  items.push(
    personas.length === 0
      ? {
          id: "reviews",
          label: "Persona reviews",
          state: "pending",
          detail: "Not run yet",
        }
      : hardFail.length
        ? {
            id: "reviews",
            label: "Persona reviews",
            state: "fail",
            detail: `Blocking: ${hardFail.map((r) => r.skill).join(", ")}`,
          }
        : soft.length
          ? {
              id: "reviews",
              label: "Persona reviews",
              state: "warn",
              detail: `Needs work: ${soft.map((r) => r.skill).join(", ")}`,
            }
          : {
              id: "reviews",
              label: "Persona reviews",
              state: "pass",
              detail: `${personas.length} passed`,
            },
  );

  const drift = s.reviews.find((r) => r.skill === DRIFT_SKILL);
  items.push(
    !opts.prdLinked
      ? {
          id: "drift",
          label: "Matches the approved PRD",
          state: "na",
          detail: "No PRD linked to this task",
        }
      : !drift
        ? {
            id: "drift",
            label: "Matches the approved PRD",
            state: "pending",
            detail: "Drift check not run yet",
          }
        : drift.status === "PASS"
          ? {
              id: "drift",
              label: "Matches the approved PRD",
              state: "pass",
              detail: "No drift found",
            }
          : {
              id: "drift",
              label: "Matches the approved PRD",
              state: "fail",
              detail: drift.summary || "Drift found",
            },
  );

  const states = items.map((i) => i.state);
  const verdict = states.some((x) => x === "fail" || x === "warn")
    ? "issues"
    : states.includes("pending")
      ? "incomplete"
      : "ready";
  return { items, verdict } as const;
}
