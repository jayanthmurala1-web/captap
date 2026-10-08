import { afterAll, beforeAll, expect, test } from "vitest";
import { createDocument } from "../documents";
import { NotFoundError, ValidationError } from "../errors";
import { createProject } from "../projects";
import { createSkill, distillLearningFromCritique } from "../skills";
import { createTasks } from "../tasks";
import { fixtures, validPrd } from "../test-fixtures";
import { buildConsultContext } from "./consult-context";

const f = fixtures();
let me: string;
let outsider: string;
let org: string;
let projectId: string;
let otherProjectId: string;

const skill = (name: string, marker: string, extra = "") =>
  `---\nname: ${name}\ndescription: Test agent ${name}\n---\n# ${name}\n${marker}\n${extra}`;

beforeAll(async () => {
  me = await f.user("ctx-me");
  outsider = await f.user("ctx-out");
  org = await f.org("ctx", { [me]: "owner" });
  await f.org("ctx-other", { [outsider]: "owner" });
  projectId = (await createProject(me, org, { name: "Ctx" })).id;
  otherProjectId = (await createProject(me, org, { name: "Ctx2" })).id;
  await createSkill(
    me,
    { orgId: org },
    { kind: "guide", source: skill("acme-writer", "ACME-WRITER-MARKER-77") },
  );
  await createSkill(
    me,
    { orgId: org },
    { kind: "review", source: skill("acme-auditor", "ACME-AUDITOR-MARKER-88") },
  );
  await createSkill(
    me,
    { orgId: org },
    { kind: "guide", source: skill("huge-agent", "x", "y".repeat(70_000)) },
  );
  await distillLearningFromCritique(me, {
    projectId,
    rule: "Always include a rollback plan",
    skillName: "acme-writer",
    source: "human_critique",
  });
  await distillLearningFromCritique(me, {
    projectId,
    rule: "Never approve without tests",
    skillName: "acme-auditor",
    source: "human_critique",
  });
});
afterAll(() => f.cleanup());

const ctx = (agentName: string, extra: object = {}) =>
  buildConsultContext(me, { orgId: org, projectId, agentName, ...extra });

test("the chosen agent's own playbook and only its learned rules become the system prompt", async () => {
  const writer = await ctx("acme-writer");
  expect(writer.system).toContain("ACME-WRITER-MARKER-77");
  expect(writer.system).toContain("Always include a rollback plan");
  expect(writer.system).not.toContain("ACME-AUDITOR-MARKER-88");
  expect(writer.system).not.toContain("Never approve without tests");

  const auditor = await ctx("acme-auditor");
  expect(auditor.system).toContain("ACME-AUDITOR-MARKER-88");
  expect(auditor.system).toContain("Never approve without tests");
  expect(auditor.system).not.toContain("ACME-WRITER-MARKER-77");
});

test("built-in agents work without anyone having created them, and the others are listed for hand-off", async () => {
  const c = await ctx("prd-writing");
  expect(c.agent).toMatchObject({ name: "prd-writing", kind: "guide" });
  expect(c.system).toMatch(/Problem/);
  expect(c.system).toContain("acme-auditor"); // directory of the other agents
  expect(c.system).not.toContain("ACME-AUDITOR-MARKER-88"); // ...but only their names, not their playbooks
});

test("guide agents can change things, review agents can only read", async () => {
  expect((await ctx("acme-writer")).toolset).toBe("full");
  expect((await ctx("acme-auditor")).toolset).toBe("read");
  expect((await ctx("code-review")).toolset).toBe("read");
});

test("there is no generic fallback: an unknown agent is an error", async () => {
  await expect(ctx("does-not-exist")).rejects.toBeInstanceOf(NotFoundError);
  await expect(ctx("")).rejects.toBeInstanceOf(NotFoundError);
});

test("a huge playbook is cut at 60 KB with a visible notice", async () => {
  const c = await ctx("huge-agent");
  expect(c.system).toMatch(/playbook was truncated/i);
  expect(c.system.length).toBeLessThan(70_000);
});

test("from a task: task, requirements and the assigned agent's playbook, but no other agent's", async () => {
  const prd = await createDocument(me, projectId, {
    title: "Checkout PRD",
    kind: "prd",
    content: validPrd.replace(
      "- Given a user signs up",
      "- Customer can pay by card\n- Given a user signs up",
    ),
  });
  const [t] = await createTasks(me, projectId, [
    {
      title: "Card payment flow",
      role: "developer",
      description: "Build it.",
      assignedSkill: "acme-writer",
      prdDocumentId: prd.id,
      requirementKeys: ["R-1"],
    },
  ]);
  const c = await buildConsultContext(me, {
    orgId: org,
    taskId: t.id,
    agentName: "acme-writer",
  });
  expect(c.system).toContain("Card payment flow");
  expect(c.system).toContain("R-1");
  expect(c.system).toContain("Customer can pay by card");
  expect(c.system).toContain("ACME-WRITER-MARKER-77");
  expect(c.system).not.toContain("ACME-AUDITOR-MARKER-88");
  expect(c.projectId).toBe(projectId);
  expect(c.defaultAgent).toBe("acme-writer");

  // a task from another project than the one given is refused
  await expect(
    buildConsultContext(me, {
      orgId: org,
      projectId: otherProjectId,
      taskId: t.id,
      agentName: "acme-writer",
    }),
  ).rejects.toBeInstanceOf(ValidationError);
  // and someone outside the org sees nothing
  await expect(
    buildConsultContext(outsider, {
      orgId: org,
      taskId: t.id,
      agentName: "acme-writer",
    }),
  ).rejects.toThrow();
});

test("the frame tells the model what it cannot do, and never lets the client write the system prompt", async () => {
  const c = await ctx("acme-writer");
  expect(c.system).toMatch(/cannot approve/i);
  expect(c.system).toContain(`Current active project ID: "${projectId}"`);
});
