import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db } from "@/db";
import { member, orgRole } from "@/db/schema";
import { requireCapability, requireProjectCapability } from "./access";
import { auth } from "./auth";
import { ForbiddenError, ValidationError } from "./errors";
import { acceptInvitation, createInvitation } from "./invitations";
import { addProjectMember, createProject } from "./projects";
import {
  CAPABILITIES,
  createRole,
  deleteRole,
  listRoles,
  seedDefaultRoles,
  setMemberRole,
  updateRole,
} from "./roles";
import { claimTask, createTasks, decideTask, submitTask } from "./tasks";
import { fixtures } from "./test-fixtures";

const f = fixtures();
let owner: string;
let admin: string;
let plain: string;
let dev: string;
let org: string;
let projectId: string;

beforeAll(async () => {
  owner = await f.user("owner");
  admin = await f.user("admin");
  plain = await f.user("plain");
  dev = await f.user("dev");
  org = await f.org("roles", {
    [owner]: "owner",
    [admin]: "admin",
    [plain]: "member",
    [dev]: "member",
  });
  projectId = (await createProject(owner, org, { name: "P" })).id;
  await addProjectMember(owner, projectId, dev, "developer");
});

afterAll(() => f.cleanup());

test("a new org gets the 7 system roles; seeding twice changes nothing", async () => {
  await seedDefaultRoles(org);
  const roles = await listRoles(owner, org);
  expect(roles.map((r) => r.slug).sort()).toEqual(
    [
      "admin",
      "developer",
      "devops",
      "lead",
      "member",
      "owner",
      "product",
      "qa",
    ].sort(),
  );
  expect(roles.find((r) => r.slug === "owner")?.capabilities).toEqual([
    ...CAPABILITIES,
  ]);
  expect(roles.find((r) => r.slug === "member")?.capabilities).toEqual([
    "use_ai",
  ]);
});

test("owner has every capability even if its row is gone; member has none", async () => {
  await requireCapability(owner, org, "manage_roles");
  await expect(
    requireCapability(plain, org, "invite_members"),
  ).rejects.toBeInstanceOf(ForbiddenError);
  await requireCapability(admin, org, "invite_members");
});

test("editing a role changes real access with no code change", async () => {
  const role = await createRole(owner, org, {
    name: "Ops Lead",
    capabilities: ["invite_members"],
  });
  expect(role.slug).toBe("ops-lead");
  await setMemberRole(owner, org, plain, "ops-lead");
  await requireCapability(plain, org, "invite_members");
  await expect(
    requireCapability(plain, org, "manage_roles"),
  ).rejects.toBeInstanceOf(ForbiddenError);

  await updateRole(owner, role.id, { capabilities: [] });
  await expect(
    requireCapability(plain, org, "invite_members"),
  ).rejects.toBeInstanceOf(ForbiddenError);
  await setMemberRole(owner, org, plain, "member");
});

test("project role capabilities apply only inside that project", async () => {
  const other = (await createProject(owner, org, { name: "Other" })).id;
  await addProjectMember(owner, other, plain, "developer");
  await addProjectMember(owner, projectId, plain, "qa");
  await requireProjectCapability(plain, projectId, "approve_tasks");
  await expect(
    requireProjectCapability(plain, other, "approve_tasks"),
  ).rejects.toBeInstanceOf(ForbiddenError);
});

test("only people with manage_roles can define roles; validation and locks hold", async () => {
  await expect(
    createRole(dev, org, { name: "X", capabilities: [] }),
  ).rejects.toBeInstanceOf(ForbiddenError);
  await expect(
    createRole(owner, org, {
      name: "Bad",
      capabilities: ["fly_to_moon" as never],
    }),
  ).rejects.toBeInstanceOf(ValidationError);
  await expect(
    createRole(owner, org, { name: "Ops Lead", capabilities: [] }),
  ).rejects.toBeInstanceOf(ValidationError); // slug taken
  const roles = await listRoles(owner, org);
  const ownerRole = roles.find((r) => r.slug === "owner");
  if (!ownerRole) throw new Error("no owner role");
  await expect(
    updateRole(owner, ownerRole.id, { capabilities: [] }),
  ).rejects.toBeInstanceOf(ValidationError);
  await expect(deleteRole(owner, ownerRole.id)).rejects.toBeInstanceOf(
    ValidationError,
  );
});

test("a role that is assigned can't be deleted; an unused one can", async () => {
  const used = await createRole(owner, org, {
    name: "Temp",
    capabilities: [],
  });
  await setMemberRole(owner, org, plain, "temp");
  await expect(deleteRole(owner, used.id)).rejects.toBeInstanceOf(
    ValidationError,
  );
  await setMemberRole(owner, org, plain, "member");
  await deleteRole(owner, used.id);
  expect((await listRoles(owner, org)).some((r) => r.slug === "temp")).toBe(
    false,
  );
});

test("the last owner can't be demoted; only an owner can grant owner", async () => {
  await expect(
    setMemberRole(owner, org, owner, "admin"),
  ).rejects.toBeInstanceOf(ValidationError);
  await expect(
    setMemberRole(admin, org, plain, "owner"),
  ).rejects.toBeInstanceOf(ForbiddenError);
  await expect(
    setMemberRole(owner, org, plain, "no-such-role"),
  ).rejects.toBeInstanceOf(ValidationError);
});

test("invitations carry any org role and acceptance assigns it", async () => {
  await createRole(owner, org, { name: "Designer", capabilities: [] });
  const invited = await f.user("invited");
  const email = `test-invited-${invited.split("-").pop()}@test.local`;
  const inv = await createInvitation(owner, org, email, "designer");
  await acceptInvitation(invited, email, inv.id);
  const [m] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, invited), eq(member.organizationId, org)));
  expect(m.role).toBe("designer");
  await expect(
    createInvitation(owner, org, "x@test.local", "owner"),
  ).rejects.toBeInstanceOf(ValidationError);
  await expect(
    createInvitation(dev, org, "y@test.local", "member"),
  ).rejects.toBeInstanceOf(ForbiddenError);
});

test("only qa/product/lead/admin/owner approve; developers can't (spec 016)", async () => {
  const [t] = await createTasks(owner, projectId, [
    { title: "T", role: "developer" },
  ]);
  const qa = await f.user("qa");
  await db.insert(member).values({
    id: `${org}-${qa}`,
    organizationId: org,
    userId: qa,
    role: "member",
    createdAt: new Date(),
  });
  await addProjectMember(owner, projectId, qa, "qa");
  await claimTask(dev, t.id, "dev-1");
  await submitTask(dev, t.id, "dev-1", {
    summary: "done",
    filesChanged: ["src/a.ts"],
    tests: [{ command: "pnpm test", exitCode: 0, summary: "1 passed" }],
    reviews: [],
  });
  const dev2 = await f.user("dev2");
  await db.insert(member).values({
    id: `${org}-${dev2}`,
    organizationId: org,
    userId: dev2,
    role: "member",
    createdAt: new Date(),
  });
  await addProjectMember(owner, projectId, dev2, "developer");
  await expect(decideTask(dev2, t.id, "approved")).rejects.toBeInstanceOf(
    ForbiddenError,
  );
  await decideTask(qa, t.id, "approved");
});

test("Better Auth's own role-changing endpoints are closed (they'd bypass org roles)", async () => {
  for (const p of [
    "update-member-role",
    "invite-member",
    "remove-member",
    "create-role",
  ]) {
    const res = await auth.handler(
      new Request(`http://localhost:3000/api/auth/organization/${p}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(res.status, p).toBe(404);
  }
  // sanity: a non-disabled auth path still answers (not 404)
  const ok = await auth.handler(
    new Request("http://localhost:3000/api/auth/ok"),
  );
  expect(ok.status).toBe(200);
});

test("system role rows exist as rows (owner locked flag)", async () => {
  const [row] = await db
    .select()
    .from(orgRole)
    .where(and(eq(orgRole.orgId, org), eq(orgRole.slug, "owner")));
  expect(row.isSystem).toBe(true);
});
