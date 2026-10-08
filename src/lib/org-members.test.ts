import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db } from "@/db";
import {
  member,
  organization,
  projectMember,
  session,
  task,
} from "@/db/schema";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import {
  addProjectMember,
  createProject,
  deleteProject,
  updateProject,
} from "./projects";
import { removeMember, renameOrganization } from "./roles";
import { claimNextTask, claimTask, createTasks } from "./tasks";
import { fixtures } from "./test-fixtures";

const f = fixtures();
let owner1: string;
let owner2: string;
let admin: string;
let plain: string;
let worker: string;
let org: string;
let projectId: string;

beforeAll(async () => {
  owner1 = await f.user("om-owner1");
  owner2 = await f.user("om-owner2");
  admin = await f.user("om-admin");
  plain = await f.user("om-plain");
  worker = await f.user("om-worker");
  org = await f.org("om", {
    [owner1]: "owner",
    [owner2]: "owner",
    [admin]: "admin",
    [plain]: "member",
    [worker]: "member",
  });
  projectId = (await createProject(owner1, org, { name: "Ship" })).id;
  await addProjectMember(owner1, projectId, worker, "developer");
});

afterAll(() => f.cleanup());

const isMember = async (userId: string) =>
  (
    await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, org), eq(member.userId, userId)))
  ).length > 0;

test("a plain member cannot remove anyone; an admin cannot remove an owner", async () => {
  await expect(removeMember(plain, org, worker)).rejects.toBeInstanceOf(
    ForbiddenError,
  );
  // Regression: removeMember skipped the "only an owner can change who the owners are" rule that
  // setMemberRole enforces, so an admin (who holds every capability) could remove an owner.
  await expect(removeMember(admin, org, owner2)).rejects.toThrow(
    /Only an owner can remove an owner/,
  );
  expect(await isMember(owner2)).toBe(true);
});

test("an owner can remove another owner, but the last owner can neither be removed nor leave", async () => {
  await removeMember(owner1, org, owner2); // two owners -> one
  expect(await isMember(owner2)).toBe(false);

  await expect(removeMember(owner1, org, owner1)).rejects.toThrow(/last owner/);
  expect(await isMember(owner1)).toBe(true);

  // Put owner2 back so the rest of this file starts from the same state.
  await db.insert(member).values({
    id: `${org}-${owner2}-back`,
    organizationId: org,
    userId: owner2,
    role: "owner",
    createdAt: new Date(),
  });
});

test("removing a member also strands nothing: project role, assigned and claimed work, active session", async () => {
  const [assigned, claimed] = await createTasks(owner1, projectId, [
    { title: "Assigned to worker", role: "developer", assigneeId: worker },
    { title: "Claimed by worker", role: "developer" },
  ]);
  await claimTask(worker, claimed.id, "agent-1");
  await db.insert(session).values({
    id: `sess-${worker}`,
    token: `tok-${worker}`,
    userId: worker,
    expiresAt: new Date(Date.now() + 3_600_000),
    updatedAt: new Date(),
    activeOrganizationId: org,
  });

  await removeMember(owner1, org, worker);

  expect(await isMember(worker)).toBe(false);
  expect(
    await db
      .select({ id: projectMember.id })
      .from(projectMember)
      .where(
        and(
          eq(projectMember.userId, worker),
          eq(projectMember.projectId, projectId),
        ),
      ),
  ).toHaveLength(0);

  const [a] = await db.select().from(task).where(eq(task.id, assigned.id));
  expect(a.assigneeId).toBeNull(); // back in the pool, not pinned to someone who's gone
  const [c] = await db.select().from(task).where(eq(task.id, claimed.id));
  expect(c).toMatchObject({
    status: "todo",
    claimedBy: null,
    claimedAgent: null,
  });

  // The practical point: an agent can now actually pick both of them up.
  expect(await claimNextTask(owner1, projectId, "agent-2")).not.toBeNull();

  const [s] = await db
    .select()
    .from(session)
    .where(eq(session.id, `sess-${worker}`));
  expect(s.activeOrganizationId).toBeNull(); // they land on workspace setup, not an error wall
});

test("anyone can leave on their own; removing someone who isn't a member is refused", async () => {
  await removeMember(plain, org, plain); // no capability needed to leave
  expect(await isMember(plain)).toBe(false);
  await expect(removeMember(owner1, org, plain)).rejects.toBeInstanceOf(
    NotFoundError,
  );
});

test("renaming the workspace needs manage_org_settings and a real name", async () => {
  await expect(
    renameOrganization(plain, org, "Hijacked"),
  ).rejects.toBeInstanceOf(ForbiddenError);
  await expect(renameOrganization(admin, org, "   ")).rejects.toBeInstanceOf(
    ValidationError,
  );
  await renameOrganization(admin, org, "  Northwind Studio  ");
  const [row] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, org));
  expect(row.name).toBe("Northwind Studio");
});

test("project rename and delete need manage_project_settings; delete is atomic and cascades", async () => {
  const pid = (await createProject(owner1, org, { name: "Scratch" })).id;
  // A project member who is genuinely in the project but holds no manage_project_settings, so a
  // refusal below is about permission, not about "can't see the project at all".
  const lowly = await f.user("om-lowly");
  await db.insert(member).values({
    id: `${org}-${lowly}`,
    organizationId: org,
    userId: lowly,
    role: "member",
    createdAt: new Date(),
  });
  await addProjectMember(owner1, pid, lowly, "developer");

  await expect(updateProject(lowly, pid, { name: "x" })).rejects.toBeInstanceOf(
    ForbiddenError,
  );
  await expect(deleteProject(lowly, pid)).rejects.toBeInstanceOf(
    ForbiddenError,
  );
  await expect(
    updateProject(owner1, pid, { name: "  " }),
  ).rejects.toBeInstanceOf(ValidationError);
  expect((await updateProject(owner1, pid, { name: "Renamed" })).name).toBe(
    "Renamed",
  );

  await createTasks(owner1, pid, [
    { title: "goes with it", role: "developer" },
  ]);
  await deleteProject(owner1, pid);
  expect(
    await db.select({ id: task.id }).from(task).where(eq(task.projectId, pid)),
  ).toHaveLength(0); // the cascade really took the tasks with it
});
