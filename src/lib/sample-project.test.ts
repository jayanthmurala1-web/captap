import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db } from "@/db";
import { task } from "@/db/schema";
import { getApprovalStatus } from "./document-share";
import { listDocuments } from "./documents";
import { ForbiddenError } from "./errors";
import { listRequirements } from "./requirements";
import { createSampleProject, SAMPLE_PROJECT_NAME } from "./sample-project";
import { getTask } from "./tasks";
import { fixtures } from "./test-fixtures";

const f = fixtures();
let owner: string;
let plain: string;
let org: string;

beforeAll(async () => {
  owner = await f.user("sample-owner");
  plain = await f.user("sample-plain");
  org = await f.org("sample", { [owner]: "owner", [plain]: "member" });
});
afterAll(() => f.cleanup());

test("the sample shows the whole loop: client-approved PRD, numbered requirements, tasks in four states, one failing a requirement", async () => {
  const { projectId, taskId } = await createSampleProject(owner, org);

  const [prd] = (await listDocuments(owner, projectId)).filter(
    (d) => d.docType === "prd",
  );
  const approval = await getApprovalStatus(owner, prd.id);
  expect(approval).toMatchObject({
    stale: false,
    latest: { decision: "approved", version: 1 },
  });

  const { requirements } = await listRequirements(owner, prd.id);
  expect(requirements.map((r) => r.key)).toEqual(["R-1", "R-2", "R-3", "R-4"]);
  // Each requirement is linked to exactly one task, so the PRD page shows four different states.
  expect(requirements.every((r) => r.tasks.length === 1)).toBe(true);

  const rows = await db
    .select()
    .from(task)
    .where(eq(task.projectId, projectId));
  expect(rows.map((t) => t.status).sort()).toEqual([
    "done",
    "in_progress",
    "in_review",
    "todo",
  ]);

  // The task to land on is the one whose agent says "done" but whose work misses R-3.
  expect(taskId).toBeTruthy();
  const review = await getTask(owner, taskId as string);
  expect(review.status).toBe("in_review");
  const drift = review.submissions[0].reviews.find(
    (r) => r.skill === "requirement-drift",
  );
  expect(drift?.status).toBe("NEEDS_WORK");
  expect(drift?.criteriaChecks?.some((c) => !c.passed)).toBe(true);
});

test("calling it again returns the same sample instead of piling up copies", async () => {
  const a = await createSampleProject(owner, org);
  const b = await createSampleProject(owner, org);
  expect(b).toEqual(a);
  const rows = await db.query.project.findMany({
    where: (p, { and, eq }) =>
      and(eq(p.orgId, org), eq(p.name, SAMPLE_PROJECT_NAME)),
  });
  expect(rows).toHaveLength(1);
});

test("only someone who may create projects can create it", async () => {
  await expect(createSampleProject(plain, org)).rejects.toBeInstanceOf(
    ForbiddenError,
  );
});
