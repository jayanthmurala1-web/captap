import { afterAll, beforeAll, expect, test } from "vitest";
import { db } from "@/db";
import { member } from "@/db/schema";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { addProjectMember, createProject } from "./projects";
import { fixtures } from "./test-fixtures";
import {
  computeWebhookSignature,
  createWebhookSubscription,
  deleteWebhookSubscription,
  dispatchWebhookEvent,
  listWebhookDeliveries,
  listWebhookSubscriptions,
  testWebhookSubscription,
  updateWebhookSubscription,
} from "./webhooks";

const f = fixtures();

let owner: string;
let outsider: string;
let orgId: string;
let projectId: string;

beforeAll(async () => {
  owner = await f.user("webhook-owner");
  outsider = await f.user("webhook-outsider");

  orgId = await f.org("webhook-org", {
    [owner]: "owner",
  });

  const proj = await createProject(owner, orgId, {
    name: "Webhook Project",
    description: "Real-time CI/CD and bot event testing",
  });
  projectId = proj.id;
});

afterAll(async () => {
  await f.cleanup();
});

test("Phase 3.8: computeWebhookSignature generates correct HMAC-SHA256 digest", () => {
  const payload = { event: "task.created", id: "123" };
  const secret = "super-secret-key-123456";
  const sig = computeWebhookSignature(payload, secret);

  expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);

  // Consistent signature for identical payload and secret
  const sig2 = computeWebhookSignature(payload, secret);
  expect(sig2).toBe(sig);

  // Different secret produces different signature
  const sigOther = computeWebhookSignature(payload, "different-key-123456");
  expect(sigOther).not.toBe(sig);
});

test("Phase 3.8: createWebhookSubscription registers endpoint and rejects invalid URLs", async () => {
  // Valid local/dev URL
  const sub = await createWebhookSubscription(owner, {
    projectId,
    name: "CI Dispatcher",
    url: "http://localhost:9999/webhook/ci",
    events: ["task.created", "task.approved", "pr.synthesized"],
    secret: "test-secret-12345678",
  });

  expect(sub.id).toBeDefined();
  expect(sub.name).toBe("CI Dispatcher");
  expect(sub.events).toContain("task.created");
  expect(sub.secret).toBe("test-secret-12345678");

  // Invalid URL should throw ValidationError
  await expect(
    createWebhookSubscription(owner, {
      projectId,
      name: "Bad Webhook",
      url: "not-a-valid-url",
      events: ["task.created"],
    }),
  ).rejects.toThrow();

  // Insecure non-local URL should throw ValidationError
  await expect(
    createWebhookSubscription(owner, {
      projectId,
      name: "Insecure Webhook",
      url: "http://myinsecureserver.com/hook",
      events: ["task.created"],
    }),
  ).rejects.toThrow(/HTTPS/i);
});

test("Phase 3.8: dispatchWebhookEvent filters matching events and records delivery log", async () => {
  // Create subscription listening for task.submitted
  const sub = await createWebhookSubscription(owner, {
    projectId,
    name: "Slack Alert Bot",
    url: "http://localhost:9998/webhook/slack",
    events: ["task.submitted"],
    secret: "slack-secret-123456",
  });

  // Dispatch an unmatched event: should not dispatch
  const resUnmatched = await dispatchWebhookEvent(
    "doc.published",
    { docId: "D-1" },
    { projectId, orgId },
  );
  expect(resUnmatched.dispatchedCount).toBe(0);

  // Dispatch matched event: should attempt dispatch and log
  const resMatched = await dispatchWebhookEvent(
    "task.submitted",
    { taskId: "T-1", commitSha: "abc1234" },
    { projectId, orgId },
  );
  expect(resMatched.dispatchedCount).toBeGreaterThanOrEqual(1);

  // Check delivery audit logs
  const deliveries = await listWebhookDeliveries(owner, sub.id);
  expect(deliveries.length).toBeGreaterThanOrEqual(1);
  expect(deliveries[0].eventType).toBe("task.submitted");
  expect(deliveries[0].status).toBe("failed"); // localhost:9998 has no server, safely marked failed
});

test("Phase 3.8: testWebhookSubscription sends ping event and records attempt", async () => {
  const sub = await createWebhookSubscription(owner, {
    projectId,
    name: "Ping Tester",
    url: "http://localhost:9997/webhook/ping",
    events: ["ping"],
  });

  const testRes = await testWebhookSubscription(owner, sub.id);
  expect(testRes.durationMs).toBeGreaterThanOrEqual(0);
  expect(testRes.message).toBeDefined();

  const deliveries = await listWebhookDeliveries(owner, sub.id);
  expect(deliveries.some((d) => d.eventType === "ping")).toBe(true);
});

test("Phase 3.8: deleteWebhookSubscription removes endpoint and deliveries", async () => {
  const sub = await createWebhookSubscription(owner, {
    projectId,
    name: "Temporary Hook",
    url: "http://localhost:9996/webhook/temp",
    events: ["task.created"],
  });

  const delRes = await deleteWebhookSubscription(owner, sub.id);
  expect(delRes.success).toBe(true);

  const remaining = await listWebhookSubscriptions(owner, { projectId });
  expect(remaining.some((s) => s.id === sub.id)).toBe(false);
});

test("Phase 3.8: Multi-tenant security prevents outsiders from accessing webhooks", async () => {
  await expect(
    createWebhookSubscription(outsider, {
      projectId,
      name: "Hacker Hook",
      url: "http://localhost:9995/hack",
      events: ["task.created"],
    }),
  ).rejects.toThrow();

  await expect(
    listWebhookSubscriptions(outsider, { projectId }),
  ).rejects.toThrow();
});

test("project webhooks are admin-only, and signing secrets are never listed", async () => {
  const dev = await f.user("webhook-dev");
  await db.insert(member).values({
    id: `${orgId}-${dev}`,
    organizationId: orgId,
    userId: dev,
    role: "member",
    createdAt: new Date(),
  });
  await addProjectMember(owner, projectId, dev, "developer");

  // A plain project member can't register an endpoint (it would receive every project event)...
  await expect(
    createWebhookSubscription(dev, {
      projectId,
      name: "exfil",
      url: "https://attacker.example.com/hook",
      events: ["task.submitted"],
    }),
  ).rejects.toBeInstanceOf(ForbiddenError);
  // ...or list them (the listing used to include HMAC secrets).
  await expect(
    listWebhookSubscriptions(dev, { projectId }),
  ).rejects.toBeInstanceOf(ForbiddenError);

  const created = await createWebhookSubscription(owner, {
    projectId,
    name: "CI",
    url: "https://ci.example.com/hook",
    events: ["task.approved"],
    secret: "shown-once-secret-123",
  });
  expect(created.secret).toBe("shown-once-secret-123");
  await expect(
    deleteWebhookSubscription(dev, created.id),
  ).rejects.toBeInstanceOf(ForbiddenError);
  const listed = await listWebhookSubscriptions(owner, { projectId });
  expect(listed.length).toBeGreaterThan(0);
  for (const s of listed) expect("secret" in s).toBe(false);
});

test("an endpoint can be edited and paused; a paused one receives nothing; the secret never changes", async () => {
  const p = (await createProject(owner, orgId, { name: "Pausable" })).id;
  const sub = await createWebhookSubscription(owner, {
    projectId: p,
    name: "Ops",
    url: "http://localhost:9997/hook",
    events: ["task.claimed"],
    secret: "ops-secret-12345678",
  });
  const fire = (event: "task.claimed" | "task.rejected") =>
    dispatchWebhookEvent(event, { taskId: "T-1" }, { projectId: p, orgId });

  expect((await fire("task.claimed")).dispatchedCount).toBe(1);

  await updateWebhookSubscription(owner, sub.id, { active: false });
  expect((await fire("task.claimed")).dispatchedCount).toBe(0); // paused: nothing sent
  expect(await listWebhookDeliveries(owner, sub.id)).toHaveLength(1);

  await updateWebhookSubscription(owner, sub.id, { active: true });
  expect((await fire("task.claimed")).dispatchedCount).toBe(1);

  // Editing the events changes what it hears; the signing secret is untouched.
  await updateWebhookSubscription(owner, sub.id, {
    name: "Ops v2",
    events: ["task.rejected"],
  });
  expect((await fire("task.claimed")).dispatchedCount).toBe(0);
  expect((await fire("task.rejected")).dispatchedCount).toBe(1);
  const [after] = (
    await listWebhookSubscriptions(owner, { projectId: p })
  ).filter((s) => s.id === sub.id);
  expect(after.name).toBe("Ops v2");
  expect(after).not.toHaveProperty("secret"); // never listed
  const stored = await db.query.webhookSubscription.findFirst({
    where: (t, { eq }) => eq(t.id, sub.id),
  });
  expect(stored?.secret).toBe("ops-secret-12345678");

  // The same URL rules apply on edit, empty edits are refused, and outsiders can't see it, let alone touch it.
  await expect(
    updateWebhookSubscription(owner, sub.id, {
      url: "http://myinsecureserver.com/hook",
    }),
  ).rejects.toThrow(/HTTPS/i);
  await expect(
    updateWebhookSubscription(owner, sub.id, {}),
  ).rejects.toBeInstanceOf(ValidationError);
  await expect(
    updateWebhookSubscription(outsider, sub.id, { active: false }),
  ).rejects.toBeInstanceOf(NotFoundError);
});
