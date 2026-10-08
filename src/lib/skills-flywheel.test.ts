import { afterAll, beforeAll, expect, test } from "vitest";
import { createDocument } from "./documents";
import { addProjectMember, createProject } from "./projects";
import {
  deleteLearnedRule,
  distillLearningFromCritique,
  extractKeywords,
  getSkill,
  listLearnedRules,
  matchSkillsForTask,
} from "./skills";
import {
  claimTask,
  createTasks,
  decideTask,
  getTask,
  getTaskExecutionBundle,
  submitTask,
} from "./tasks";
import { fixtures } from "./test-fixtures";

const f = fixtures();

let owner: string;
let dev: string;
let qa: string;
let orgId: string;
let projectId: string;

beforeAll(async () => {
  owner = await f.user("skills-owner");
  dev = await f.user("skills-dev");
  qa = await f.user("skills-qa");

  orgId = await f.org("flywheel-corp", {
    [owner]: "owner",
    [dev]: "member",
    [qa]: "member",
  });

  const proj = await createProject(owner, orgId, {
    name: "Flywheel Engine Project",
    description: "Continuous learning demonstration project",
  });
  projectId = proj.id;

  await addProjectMember(owner, projectId, dev, "developer");
  await addProjectMember(owner, projectId, qa, "qa");

  // Create sample ERD and LLD architecture documents
  await createDocument(owner, projectId, {
    title: "Database Entity-Relationship Diagram",
    kind: "doc",
    docType: "erd",
    visibility: "published",
    content: "erDiagram\n  PROJECT ||--o{ TASK : contains",
    note: "Initial ERD",
  });

  await createDocument(owner, projectId, {
    title: "Low-Level Design Specification",
    kind: "doc",
    docType: "lld",
    visibility: "published",
    content: "# LLD: Auth and API Endpoints",
    note: "Initial LLD",
  });
});

afterAll(() => f.cleanup());

test("Phase 3.4: extractKeywords tokenizes and removes common stop words", () => {
  const text =
    "Please make sure to add zod validation when handling database migrations in api route";
  const kw = extractKeywords(text);
  expect(kw).toContain("zod");
  expect(kw).toContain("validation");
  expect(kw).toContain("handling");
  expect(kw).toContain("database");
  expect(kw).toContain("migrations");
  expect(kw).toContain("api");
  expect(kw).toContain("route");
  expect(kw).not.toContain("please");
  expect(kw).not.toContain("make");
  expect(kw).not.toContain("sure");
});

test("Phase 3.4: matchSkillsForTask injects role-based skills and domain architecture docs", async () => {
  const [devTask, qaTask] = await createTasks(owner, projectId, [
    {
      title: "Design PostgreSQL database schema and migrations",
      description:
        "Setup tables with Drizzle ORM and write SQL migration script",
      role: "developer",
    },
    {
      title: "End-to-End Test Suite for Order Flow",
      description: "Automate test cases verifying checkout and payment API",
      role: "qa",
    },
  ]);

  // 1. Dev Task Matching
  const devContext = await matchSkillsForTask(owner, devTask.id);
  expect(devContext.matchedSkills.some((s) => s.name === "code-review")).toBe(
    true,
  );
  const devRoleMatch = devContext.matchedSkills.find(
    (s) => s.name === "code-review",
  );
  expect(devRoleMatch?.reason).toContain("developer");

  // Matched ERD because of database / migrations / postgres / sql keywords
  expect(devContext.suggestedDocs.some((d) => d.docType === "erd")).toBe(true);

  // 2. QA Task Matching
  const qaContext = await matchSkillsForTask(owner, qaTask.id);
  expect(qaContext.matchedSkills.some((s) => s.name === "qa-review")).toBe(
    true,
  );
  const qaRoleMatch = qaContext.matchedSkills.find(
    (s) => s.name === "qa-review",
  );
  expect(qaRoleMatch?.reason).toContain("qa");
});

test("Phase 3.4: distillLearningFromCritique enriches project skill with gotchas section", async () => {
  const ruleText =
    "Never perform database migrations without wrapping in an explicit transaction block";
  const distilled = await distillLearningFromCritique(owner, {
    projectId,
    skillName: "code-review",
    rule: ruleText,
    source: "human_critique",
  });

  expect(distilled.id).toBeDefined();
  expect(distilled.rule).toBe(ruleText);
  expect(distilled.skillName).toBe("code-review");

  // Effective project skill should now contain ## 🧠 Continuous Learnings & Gotchas
  const projectSkill = await getSkill(owner, { projectId }, "code-review");
  expect(projectSkill.projectId).toBe(projectId); // Project override created
  expect(projectSkill.source).toContain("## 🧠 Continuous Learnings & Gotchas");
  expect(projectSkill.source).toContain(ruleText);
});

test("Phase 3.4: Reinforcement Flywheel in decideTask automatically records gotchas and injects into future tasks", async () => {
  // Create task 1
  const [t1] = await createTasks(owner, projectId, [
    {
      title: "Add stripe checkout webhook handler",
      description: "Handle checkout.session.completed event",
      role: "developer",
    },
  ]);

  // Dev claims and submits
  await claimTask(dev, t1.id, "dev-agent-1");
  await submitTask(dev, t1.id, "dev-agent-1", {
    summary: "Implemented stripe webhook listener",
    filesChanged: ["src/app/api/webhooks/stripe/route.ts"],
    tests: [{ command: "pnpm test", exitCode: 0, summary: "Tests passing" }],
  });

  // Human rejects with addToLearnedRules enabled
  const rejectionCritique =
    "Webhook handlers must always verify Stripe signature headers before processing body";
  await decideTask(owner, t1.id, "rejected", rejectionCritique, {
    addToLearnedRules: true,
    targetSkillName: "code-review",
  });

  // Verify task was sent back
  const back = await getTask(owner, t1.id);
  expect(back.status).toBe("in_progress");
  expect(back.reviewNote).toBe(rejectionCritique);

  // Verify gotcha was recorded in learned rules
  const rules = await listLearnedRules(owner, projectId);
  const foundRule = rules.find((r) =>
    r.rule.includes("Stripe signature headers"),
  );
  expect(foundRule).toBeDefined();
  expect(foundRule?.sourceTaskKey).toBe(back.key);

  // Future tasks in the same project automatically inherit this gotcha!
  const [t2] = await createTasks(owner, projectId, [
    {
      title: "Build refund webhook handler",
      description: "Process refund events from payment processor",
      role: "developer",
    },
  ]);

  const bundle = await getTaskExecutionBundle(owner, t2.id);
  expect(
    bundle.learnedRules.some((r) =>
      r.rule.includes("Stripe signature headers"),
    ),
  ).toBe(true);
  expect(bundle.matchedSkills.some((s) => s.name === "code-review")).toBe(true);
  expect(bundle.gitIsolation.suggestedBranch).toContain("task/t-");
});

test("Phase 3.4: listLearnedRules and deleteLearnedRule manage institutional rules", async () => {
  const created = await distillLearningFromCritique(owner, {
    projectId,
    skillName: "qa-review",
    rule: "Always include negative test cases for invalid authentication tokens",
    source: "manual",
  });

  const qaRules = await listLearnedRules(owner, projectId, "qa-review");
  expect(qaRules.some((r) => r.id === created.id)).toBe(true);

  // Delete rule
  await deleteLearnedRule(owner, created.id);
  const afterDelete = await listLearnedRules(owner, projectId, "qa-review");
  expect(afterDelete.some((r) => r.id === created.id)).toBe(false);
});
