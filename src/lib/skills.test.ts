import { afterAll, beforeAll, expect, test } from "vitest";
import { ForbiddenError, NotFoundError } from "./access";
import { ConflictError } from "./errors";
import { addProjectMember, createProject } from "./projects";
import {
  createSkill,
  deleteSkill,
  distillLearningFromCritique,
  getSkill,
  listOrgLearnedRules,
  listSkills,
  seedDefaultSkills,
  updateSkill,
} from "./skills";
import { fixtures } from "./test-fixtures";

const f = fixtures();
const md = (name: string, body = "") =>
  `---\nname: ${name}\ndescription: ${name} skill\n---\n${body}`;
let owner: string;
let dev: string;
let outsider: string;
let orgA: string;
let projectId: string;

beforeAll(async () => {
  owner = await f.user("owner");
  dev = await f.user("dev");
  outsider = await f.user("out");
  orgA = await f.org("a", { [owner]: "owner", [dev]: "member" });
  await f.org("b", { [outsider]: "owner" });
  await seedDefaultSkills(orgA, owner);
  projectId = (await createProject(owner, orgA, { name: "P" })).id;
  await addProjectMember(owner, projectId, dev, "developer");
});

afterAll(() => f.cleanup());

test("new orgs get the default skills, and seeding is idempotent", async () => {
  await seedDefaultSkills(orgA, owner);
  const names = (await listSkills(dev, { orgId: orgA })).map((s) => s.name);
  expect(names).toEqual([
    "code-review",
    "prd-writing",
    "qa-review",
    "task-breakdown",
  ]);
  expect(await listSkills(dev, { orgId: orgA }, "review")).toHaveLength(2);
});

test("project skill overrides the org skill of the same name, only in that project", async () => {
  // Written by the owner: this test is about override precedence, not who may write.
  await createSkill(
    owner,
    { projectId },
    { source: md("code-review", "PROJECT RULES"), kind: "review" },
  );
  const inProject = await getSkill(dev, { projectId }, "code-review");
  expect(inProject.source).toContain("PROJECT RULES");
  expect(inProject.projectId).toBe(projectId);
  expect(
    (await getSkill(dev, { orgId: orgA }, "code-review")).projectId,
  ).toBeNull();
  const scopes = Object.fromEntries(
    (await listSkills(dev, { projectId })).map((s) => [s.name, s.scope]),
  );
  expect(scopes).toMatchObject({
    "code-review": "project",
    "prd-writing": "org",
  });
});

test("org skills need manage_org_settings; project skills need manage_tasks — membership alone is not enough", async () => {
  await expect(
    createSkill(dev, { orgId: orgA }, { source: md("sneaky"), kind: "guide" }),
  ).rejects.toBeInstanceOf(ForbiddenError);
  const orgSkill = await getSkill(dev, { orgId: orgA }, "prd-writing");
  await expect(
    updateSkill(dev, orgSkill.id, { source: md("prd-writing"), kind: "guide" }),
  ).rejects.toBeInstanceOf(ForbiddenError);

  // Regression: any project member (dev here: no manage_tasks) used to be able to rewrite the
  // playbooks that govern review and task-breakdown for the whole project.
  await expect(
    createSkill(
      dev,
      { projectId },
      { source: md("deploy-steps"), kind: "guide" },
    ),
  ).rejects.toBeInstanceOf(ForbiddenError);

  const mine = await createSkill(
    owner,
    { projectId },
    { source: md("deploy-steps"), kind: "guide" },
  );
  await expect(
    updateSkill(dev, mine.id, {
      source: md("deploy-steps", "x"),
      kind: "guide",
    }),
  ).rejects.toBeInstanceOf(ForbiddenError);
  await expect(deleteSkill(dev, mine.id)).rejects.toBeInstanceOf(
    ForbiddenError,
  );
  await deleteSkill(owner, mine.id);
});

test("the learning flywheel still teaches the skill when a QA reviewer (no manage_tasks) sends work back", async () => {
  // Regression guard for the fix above: distillLearningFromCritique appends one bullet as a
  // side-effect of rejecting work. It must not demand manage_tasks, or the lesson is silently
  // dropped (the failure is swallowed by its try/catch) for exactly the people who send work back.
  const qa = await f.user("qa-reviewer");
  const o = await f.org("fly", { [owner]: "owner", [qa]: "member" });
  const pid = (await createProject(owner, o, { name: "Fly" })).id;
  await addProjectMember(owner, pid, qa, "qa");

  await expect(
    createSkill(
      qa,
      { projectId: pid },
      { source: md("code-review", "direct edit"), kind: "review" },
    ),
  ).rejects.toBeInstanceOf(ForbiddenError); // they cannot edit the playbook directly...

  await distillLearningFromCritique(qa, {
    projectId: pid,
    rule: "Always check the refund path.",
    skillName: "code-review",
  });
  // ...but the lesson still lands in the project's skill.
  const s = await getSkill(qa, { projectId: pid }, "code-review");
  expect(s.projectId).toBe(pid);
  expect(s.source).toContain("Always check the refund path.");
});

test("outsiders cannot read or write another org's skills", async () => {
  await expect(listSkills(outsider, { orgId: orgA })).rejects.toBeInstanceOf(
    ForbiddenError,
  );
  await expect(listSkills(outsider, { projectId })).rejects.toBeInstanceOf(
    NotFoundError,
  );
  const orgSkill = await getSkill(owner, { orgId: orgA }, "qa-review");
  await expect(deleteSkill(outsider, orgSkill.id)).rejects.toBeInstanceOf(
    ForbiddenError,
  );
});

test("duplicate names in the same scope are rejected with a readable error", async () => {
  await expect(
    createSkill(
      owner,
      { orgId: orgA },
      { source: md("prd-writing"), kind: "guide" },
    ),
  ).rejects.toThrow(ConflictError);
});

test("listOrgLearnedRules: workspace members see rules from every project, with where they came from", async () => {
  await distillLearningFromCritique(owner, {
    projectId,
    rule: "Map Stripe card errors to 402, never 500.",
  });
  const rules = await listOrgLearnedRules(dev, orgA);
  const r = rules.find((x) => x.rule.includes("Stripe card errors"));
  expect(r?.projectId).toBe(projectId);
  expect(r?.projectName).toBeTruthy();
  await expect(listOrgLearnedRules(outsider, orgA)).rejects.toBeInstanceOf(
    ForbiddenError,
  );
});
