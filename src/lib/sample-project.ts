import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { project, task, taskSubmission } from "@/db/schema";
import { requireCapability } from "./access";
import { createDocumentShare, submitApproval } from "./document-share";
import { createDocument } from "./documents";
import { createProject } from "./projects";
import { createTasks } from "./tasks";

export const SAMPLE_PROJECT_NAME = "Sample: Acme checkout";

const PRD = `# Acme Shop — Checkout

## Problem & Context
Acme sells handmade furniture online. Today shoppers add items to a cart and then email the shop to pay, which loses about half of all orders and costs the owner hours every week. Acme wants shoppers to pay by card on the site and get an immediate confirmation, so orders arrive paid and the owner stops chasing invoices. Launch is planned for the start of the holiday season, so the first release must be simple and reliable rather than feature-rich.

## Non-Goals
- Saving cards for later or one-click reorders
- Gift cards, coupons or loyalty points
- Multiple currencies (euros only)

## Acceptance Criteria
- A shopper can pay by card and sees an order confirmation page.
- A declined card shows a clear message and keeps the cart.
- The order confirmation email arrives within one minute of payment.
- Totals include the correct tax for the shopper's country.
`;

const SAMPLE_AGENT = "claude-code";

/**
 * Creates a small, made-up client project that shows the whole loop at a glance: a client-approved
 * PRD with numbered requirements, and tasks in four different states — including one where an agent's
 * work doesn't actually meet a requirement. Built from the real library calls; only the states that
 * need a second human or a live model (approval of work, the drift check's findings) are written
 * directly, and it's all labelled as sample data. Returns the existing sample if there already is one.
 */
export async function createSampleProject(userId: string, orgId: string) {
  await requireCapability(userId, orgId, "create_projects");

  const [existing] = await db
    .select({ id: project.id })
    .from(project)
    .where(
      and(eq(project.orgId, orgId), eq(project.name, SAMPLE_PROJECT_NAME)),
    );
  if (existing)
    return { projectId: existing.id, taskId: await reviewTaskId(existing.id) };

  const p = await createProject(userId, orgId, {
    name: SAMPLE_PROJECT_NAME,
    description:
      "Made-up sample data showing how Captap traces a client-approved PRD through to reviewed work. Safe to delete any time.",
  });

  const prd = await createDocument(userId, p.id, {
    title: "Checkout PRD",
    kind: "prd",
    docType: "prd",
    content: PRD,
    note: "Sample PRD",
  });

  // The client's sign-off goes through the same share link and approval path a real client uses.
  const share = await createDocumentShare(userId, prd.id);
  await submitApproval(share.token, {
    decision: "approved",
    approverName: "Dana Whitfield (Acme)",
    version: 1,
  });

  // The fourth task (tax) is deliberately left as an untouched to-do.
  const [pay, declines, email] = await createTasks(userId, p.id, [
    {
      title: "Card payment and order confirmation page",
      description:
        "Let a shopper pay by card at checkout and land on an order confirmation page.",
      role: "developer",
      prdDocumentId: prd.id,
      requirementKeys: ["R-1"],
    },
    {
      title: "Handle declined cards",
      description:
        "When the card is declined, tell the shopper clearly and keep their cart intact.",
      role: "developer",
      prdDocumentId: prd.id,
      requirementKeys: ["R-2"],
    },
    {
      title: "Send the order confirmation email",
      description:
        "Email the shopper a confirmation as soon as payment succeeds.",
      role: "developer",
      prdDocumentId: prd.id,
      requirementKeys: ["R-3"],
    },
    {
      title: "Add tax by country",
      description:
        "Include the correct tax in the totals for the shopper's country.",
      role: "developer",
      prdDocumentId: prd.id,
      requirementKeys: ["R-4"],
    },
  ]);

  const claim = {
    claimedBy: userId,
    claimedAgent: SAMPLE_AGENT,
    claimedAt: new Date(),
  };
  const tests = [
    { command: "pnpm test", exitCode: 0, summary: "all tests passed" },
  ];

  // Done: delivered and approved. (Approved by the sample's own user: a real team needs a second
  // person, per ADR-004, but a one-person trial can't have one.)
  await db
    .update(task)
    .set({ status: "done", ...claim })
    .where(eq(task.id, pay.id));
  await db.insert(taskSubmission).values({
    taskId: pay.id,
    submittedBy: userId,
    agent: SAMPLE_AGENT,
    summary:
      "Added the card form and the confirmation page. Tested a successful payment end to end.",
    filesChanged: ["src/checkout/pay.ts", "src/checkout/confirmation.tsx"],
    tests,
    decision: "approved",
    decidedBy: userId,
    decidedAt: new Date(),
  });

  // Sent back: a reviewer said what was missing, and the agent is working on it.
  const sentBackNote =
    "The cart is emptied when the card is declined. It must be kept so the shopper can try another card.";
  await db
    .update(task)
    .set({ status: "in_progress", reviewNote: sentBackNote, ...claim })
    .where(eq(task.id, declines.id));
  await db.insert(taskSubmission).values({
    taskId: declines.id,
    submittedBy: userId,
    agent: SAMPLE_AGENT,
    summary: "Shows an error banner when the card is declined.",
    filesChanged: ["src/checkout/errors.ts"],
    tests,
    decision: "rejected",
    decisionNote: sentBackNote,
    decidedBy: userId,
    decidedAt: new Date(),
  });

  // In review, and the interesting one: tests pass, but the work doesn't meet the requirement.
  await db
    .update(task)
    .set({ status: "in_review", ...claim })
    .where(eq(task.id, email.id));
  await db.insert(taskSubmission).values({
    taskId: email.id,
    submittedBy: userId,
    agent: SAMPLE_AGENT,
    summary:
      "Sends the order confirmation email. Added a job that emails confirmations and a template.",
    filesChanged: [
      "src/email/confirmation.ts",
      "src/jobs/send-confirmations.ts",
    ],
    tests,
    reviews: [
      {
        skill: "requirement-drift",
        status: "NEEDS_WORK",
        summary:
          "The email is sent, but not within a minute of payment as the client approved.",
        criteriaChecks: [
          {
            criterion:
              "The order confirmation email arrives within one minute of payment.",
            passed: false,
            evidence:
              "send-confirmations.ts runs on a nightly schedule, so emails go out hours after payment.",
          },
        ],
        reviewedAt: new Date().toISOString(),
      },
    ],
  });

  return { projectId: p.id, taskId: email.id };
}

async function reviewTaskId(projectId: string) {
  const [t] = await db
    .select({ id: task.id })
    .from(task)
    .where(and(eq(task.projectId, projectId), eq(task.status, "in_review")));
  return t?.id ?? null;
}
