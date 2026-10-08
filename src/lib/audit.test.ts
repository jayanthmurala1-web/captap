import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db } from "@/db";
import { auditEvent, organization } from "@/db/schema";
import { listAuditEvents, recordAudit } from "./audit";
import {
  createDocumentShare,
  revokeDocumentShare,
  submitApproval,
} from "./document-share";
import { createDocument, deleteDocument, updateDocument } from "./documents";
import { ForbiddenError } from "./errors";
import {
  acceptInvitation,
  cancelInvitation,
  createInvitation,
} from "./invitations";
import {
  addProjectMember,
  createProject,
  removeProjectMember,
} from "./projects";
import { createRole, deleteRole, setMemberRole, updateRole } from "./roles";
import {
  claimTask,
  createTasks,
  decideTask,
  deleteTask,
  releaseTask,
  submitTask,
  updateTask,
} from "./tasks";
import { fixtures, validPrd } from "./test-fixtures";
import {
  createWebhookSubscription,
  deleteWebhookSubscription,
} from "./webhooks";

const f = fixtures();
let me: string;
let qa: string;
let dev: string;
let outsider: string;
let org: string;
let otherOrg: string;
let projectId: string;

const evidence = {
  summary: "ok",
  filesChanged: ["a.ts"],
  tests: [{ command: "pnpm test", exitCode: 0, summary: "pass" }],
  reviews: [],
};

const all = async () => listAuditEvents(me, org, { limit: 200 });
const of = async (action: string) =>
  (await all()).filter((e) => e.action === action);

beforeAll(async () => {
  me = await f.user("me");
  qa = await f.user("qa");
  dev = await f.user("dev");
  outsider = await f.user("out");
  org = await f.org("audit", {
    [me]: "owner",
    [qa]: "member",
    [dev]: "member",
  });
  otherOrg = await f.org("audit-other", { [outsider]: "owner" });
  projectId = (await createProject(me, org, { name: "Audited" })).id;
  await addProjectMember(me, projectId, qa, "qa");
});

afterAll(() => f.cleanup());

test("projects and their people", async () => {
  expect(await of("project.created")).toMatchObject([
    { actorId: me, targetLabel: "Audited", projectId },
  ]);
  expect(await of("project.member_added")).toMatchObject([
    { detail: { userId: qa, role: "qa" } },
  ]);
  await removeProjectMember(me, projectId, qa);
  expect(await of("project.member_removed")).toHaveLength(1);
  await addProjectMember(me, projectId, qa, "qa");
});

test("documents: create, update, share, client decision, revoke, delete", async () => {
  const doc = await createDocument(me, projectId, {
    title: "Spec",
    kind: "prd",
    content: validPrd,
  });
  await updateDocument(me, doc.id, {
    content: `${validPrd}\n- Another criterion\n`,
    baseVersion: 1,
  });
  const share = await createDocumentShare(me, doc.id);
  await submitApproval(share.token, {
    decision: "approved",
    approverName: "Cara Client",
    version: 2,
  });
  await revokeDocumentShare(me, share.id);
  await deleteDocument(me, doc.id);

  expect(await of("document.created")).toMatchObject([
    { actorId: me, targetLabel: "Spec", detail: { version: 1 } },
  ]);
  expect(await of("document.updated")).toMatchObject([
    { detail: { version: 2 } },
  ]);
  expect(await of("document.shared")).toHaveLength(1);
  // the client has no account: no actor id, but the name they gave is on the record
  expect(await of("client.approved")).toMatchObject([
    { actorId: null, actorLabel: "Cara Client", detail: { version: 2 } },
  ]);
  expect(await of("document.share_revoked")).toHaveLength(1);
  expect(await of("document.deleted")).toMatchObject([{ targetLabel: "Spec" }]);
});

test("tasks: create, update, submit, approve, reject, delete", async () => {
  const [a, b] = await createTasks(me, projectId, [
    { title: "A", role: "developer" },
    { title: "B", role: "developer" },
  ]);
  await updateTask(me, a.id, { title: "A renamed" });
  for (const t of [a, b]) {
    await claimTask(me, t.id, "agent-1");
    await submitTask(me, t.id, "agent-1", evidence);
  }
  await decideTask(qa, a.id, "approved");
  await decideTask(qa, b.id, "rejected", "Handle empty input");
  // A rejected task is back in progress under its agent; deleting active work is refused now,
  // so release it first (a human force-release) and then delete it.
  await expect(deleteTask(me, b.id)).rejects.toThrow(
    /release or decide it first/,
  );
  await releaseTask(me, b.id, null);
  await deleteTask(me, b.id);

  expect(await of("task.created")).toHaveLength(2);
  expect(await of("task.updated")).toMatchObject([
    { targetLabel: "T-1", detail: { fields: ["title"] } },
  ]);
  expect(await of("task.submitted")).toHaveLength(2);
  expect(await of("task.approved")).toMatchObject([
    { actorId: qa, targetLabel: "T-1" },
  ]);
  expect(await of("task.rejected")).toMatchObject([
    { actorId: qa, targetLabel: "T-2", detail: { note: "Handle empty input" } },
  ]);
  expect(await of("task.deleted")).toMatchObject([{ targetLabel: "T-2" }]);
});

test("roles and membership", async () => {
  const role = await createRole(me, org, {
    name: "Auditor",
    capabilities: ["view_audit_log"],
  });
  await updateRole(me, role.id, { capabilities: [] });
  await setMemberRole(me, org, dev, "auditor");
  await setMemberRole(me, org, dev, "member");
  await deleteRole(me, role.id);

  expect(await of("role.created")).toMatchObject([
    { targetLabel: "Auditor", detail: { capabilities: ["view_audit_log"] } },
  ]);
  expect(await of("role.updated")).toMatchObject([
    { detail: { before: ["view_audit_log"], after: [] } },
  ]);
  expect((await of("member.role_changed")).map((e) => e.detail)).toEqual([
    { from: "auditor", to: "member" },
    { from: "member", to: "auditor" },
  ]); // newest first
  expect(await of("role.deleted")).toHaveLength(1);
});

test("invitations: created, cancelled, accepted", async () => {
  const one = await createInvitation(me, org, "one@test.local", "member");
  await cancelInvitation(me, org, one.id);
  const joiner = await f.user("joiner");
  const email = `${joiner}@test.local`;
  const two = await createInvitation(me, org, email, "member");
  await acceptInvitation(joiner, email, two.id);

  expect(await of("invitation.created")).toHaveLength(2);
  expect(await of("invitation.cancelled")).toMatchObject([
    { detail: { email: "one@test.local" } },
  ]);
  expect(await of("invitation.accepted")).toMatchObject([
    { actorId: joiner, detail: { email, role: "member" } },
  ]);
});

test("webhooks: created and deleted (the signing secret is never recorded)", async () => {
  const hook = await createWebhookSubscription(me, {
    projectId,
    name: "CI",
    url: "https://example.com/hook",
    events: ["task.created"],
  });
  await deleteWebhookSubscription(me, hook.id);
  const created = await of("webhook.created");
  expect(created).toMatchObject([{ targetLabel: "CI" }]);
  expect(JSON.stringify(created[0].detail)).not.toContain(hook.secret);
  expect(await of("webhook.deleted")).toHaveLength(1);
});

test("the log cannot be edited or deleted, but an organization can still be deleted", async () => {
  const [row] = await db.select().from(auditEvent).limit(1);
  await expect(
    db.update(auditEvent).set({ action: "x" }).where(eq(auditEvent.id, row.id)),
  ).rejects.toThrow();
  await expect(
    db.delete(auditEvent).where(eq(auditEvent.id, row.id)),
  ).rejects.toThrow();

  const scratch = await f.org("audit-scratch", { [me]: "owner" });
  await recordAudit(db, {
    orgId: scratch,
    actorId: me,
    action: "project.created",
    targetType: "project",
  });
  await db.delete(organization).where(eq(organization.id, scratch));
  const left = await db
    .select({ id: auditEvent.id })
    .from(auditEvent)
    .where(eq(auditEvent.orgId, scratch));
  expect(left).toEqual([]);
});

test("a rolled-back change leaves no event", async () => {
  const before = (await all()).length;
  await db
    .transaction(async (tx) => {
      await recordAudit(tx, {
        orgId: org,
        actorId: me,
        action: "project.created",
        targetType: "project",
      });
      throw new Error("boom");
    })
    .catch(() => {});
  expect((await all()).length).toBe(before);
});

test("only people with view_audit_log can read, and only their own org", async () => {
  await expect(listAuditEvents(dev, org, {})).rejects.toBeInstanceOf(
    ForbiddenError,
  );
  await expect(listAuditEvents(outsider, org, {})).rejects.toBeInstanceOf(
    ForbiddenError,
  );
  expect(await listAuditEvents(outsider, otherOrg, {})).toEqual([]);
  const area = await listAuditEvents(me, org, { area: "task", limit: 200 });
  expect(area.length).toBeGreaterThan(0);
  expect(area.every((e) => e.action.startsWith("task."))).toBe(true);
});
