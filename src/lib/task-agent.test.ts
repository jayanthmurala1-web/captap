import { afterAll, beforeAll, expect, test } from "vitest";
import { ForbiddenError, ValidationError } from "./errors";
import { addProjectMember, createProject } from "./projects";
import { createSkill, matchSkillsForTask } from "./skills";
import { assignTaskAgent, createTasks, getTask } from "./tasks";
import { fixtures } from "./test-fixtures";

// "Assign an agent" = pin one skill (playbook) to a task; agents working the task get it first.
const f = fixtures();
let owner: string;
let dev: string;
let org: string;
let projectId: string;

const skillSource = (name: string) =>
  `---\nname: ${name}\ndescription: Payments specialist.\n---\n\n# Instructions\nUse idempotency keys.\n`;

beforeAll(async () => {
  owner = await f.user("agent-owner");
  dev = await f.user("agent-dev");
  org = await f.org("agents", { [owner]: "owner", [dev]: "member" });
  projectId = (await createProject(owner, org, { name: "Agents" })).id;
  await addProjectMember(owner, projectId, dev, "developer");
  await createSkill(
    owner,
    { orgId: org },
    { kind: "guide", source: skillSource("payments-agent") },
  );
});
afterAll(() => f.cleanup());

test("an assigned agent is stored and its playbook is given to the task first", async () => {
  const [t] = await createTasks(owner, projectId, [
    {
      title: "Refund endpoint",
      role: "developer",
      assignedSkill: "payments-agent",
    },
  ]);
  expect((await getTask(owner, t.id)).assignedSkill).toBe("payments-agent");
  const { matchedSkills } = await matchSkillsForTask(owner, t.id);
  expect(matchedSkills[0]).toMatchObject({
    name: "payments-agent",
    reason: "Assigned agent",
  });
});

test("assign, change and clear the agent later; only real agents can be assigned", async () => {
  const [t] = await createTasks(owner, projectId, [
    { title: "Webhook retries", role: "developer" },
  ]);
  await assignTaskAgent(owner, t.id, "payments-agent");
  expect((await getTask(owner, t.id)).assignedSkill).toBe("payments-agent");
  await assignTaskAgent(owner, t.id, null);
  expect((await getTask(owner, t.id)).assignedSkill).toBeNull();
  await expect(
    assignTaskAgent(owner, t.id, "no-such-agent"),
  ).rejects.toBeInstanceOf(ValidationError);
  await expect(
    createTasks(owner, projectId, [
      { title: "x", role: "developer", assignedSkill: "no-such-agent" },
    ]),
  ).rejects.toBeInstanceOf(ValidationError);
});

test("plain members can't reassign agents", async () => {
  const [t] = await createTasks(owner, projectId, [
    { title: "Coupon API", role: "developer" },
  ]);
  await expect(
    assignTaskAgent(dev, t.id, "payments-agent"),
  ).rejects.toBeInstanceOf(ForbiddenError);
});
