import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db } from "@/db";
import { invitation, member, session, user } from "@/db/schema";
import { ForbiddenError, NotFoundError } from "./errors";
import {
  acceptInvitation,
  getPendingInvitation,
  listPendingInvitations,
  resendInvitation,
} from "./invitations";
import { fixtures } from "./test-fixtures";

const f = fixtures();
let owner: string;
let invitee: string;
let stranger: string;
let org: string;

async function invite(
  email: string,
  opts: { expired?: boolean; role?: string } = {},
) {
  const id = randomUUID();
  await db.insert(invitation).values({
    id,
    organizationId: org,
    email,
    role: opts.role ?? "member",
    status: "pending",
    expiresAt: new Date(Date.now() + (opts.expired ? -1 : 1) * 86_400_000),
    inviterId: owner,
  });
  return id;
}
const emailOf = async (id: string) =>
  (await db.select({ e: user.email }).from(user).where(eq(user.id, id)))[0].e;
const isMember = async (id: string) =>
  (
    await db
      .select()
      .from(member)
      .where(and(eq(member.organizationId, org), eq(member.userId, id)))
  ).length === 1;

beforeAll(async () => {
  owner = await f.user("inv-owner");
  invitee = await f.user("inv-invitee");
  stranger = await f.user("inv-stranger");
  org = await f.org("invites", { [owner]: "owner" });
});
afterAll(() => f.cleanup());

test("the invited account can accept once, and joins with the invited role", async () => {
  const id = await invite((await emailOf(invitee)).toUpperCase(), {
    role: "admin",
  });
  expect((await getPendingInvitation(id))?.orgName).toBe(org);
  await acceptInvitation(invitee, await emailOf(invitee), id);
  expect(await isMember(invitee)).toBe(true);
  const [m] = await db
    .select()
    .from(member)
    .where(and(eq(member.organizationId, org), eq(member.userId, invitee)));
  expect(m.role).toBe("admin");
  // Used up.
  expect(await getPendingInvitation(id)).toBeNull();
  await expect(
    acceptInvitation(invitee, await emailOf(invitee), id),
  ).rejects.toBeInstanceOf(NotFoundError);
});

test("someone else holding the link can't use it", async () => {
  const id = await invite("someone-else@test.local", { role: "admin" });
  await expect(
    acceptInvitation(stranger, await emailOf(stranger), id),
  ).rejects.toBeInstanceOf(ForbiddenError);
  expect(await isMember(stranger)).toBe(false);
  expect(await getPendingInvitation(id)).not.toBeNull();
});

test("an expired invitation can't be accepted even by the right person", async () => {
  const id = await invite(await emailOf(stranger), { expired: true });
  expect(await getPendingInvitation(id)).toBeNull();
  await expect(
    acceptInvitation(stranger, await emailOf(stranger), id),
  ).rejects.toBeInstanceOf(NotFoundError);
  expect(await isMember(stranger)).toBe(false);
});

test("a brand-new account (session made before it joined) lands in the invited workspace", async () => {
  const newcomer = await f.user("inv-newcomer");
  // Sign-up creates the session first, with no workspace yet.
  const sid = randomUUID();
  await db.insert(session).values({
    id: sid,
    token: randomUUID(),
    userId: newcomer,
    expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const id = await invite(await emailOf(newcomer));
  await acceptInvitation(newcomer, await emailOf(newcomer), id);
  const [s] = await db.select().from(session).where(eq(session.id, sid));
  expect(s.activeOrganizationId).toBe(org);
});

test("listPendingInvitations: admins see live invites only; members can't", async () => {
  const member1 = await f.user("inv-member");
  await db.insert(member).values({
    id: `${org}-${member1}`,
    organizationId: org,
    userId: member1,
    role: "member",
    createdAt: new Date(),
  });
  const live = await invite("live-invite@test.local");
  const dead = await invite("dead-invite@test.local", { expired: true });
  const ids = (await listPendingInvitations(owner, org)).map((i) => i.id);
  expect(ids).toContain(live);
  expect(ids).not.toContain(dead);
  await expect(listPendingInvitations(member1, org)).rejects.toBeInstanceOf(
    ForbiddenError,
  );
});

test("resending revives a lapsed invite with a fresh 7 days; only inviters can; only pending ones", async () => {
  const id = await invite("lapsed@test.local", { expired: true });
  expect(await getPendingInvitation(id)).toBeNull(); // dead link today

  const outsider = await f.user("inv-outsider");
  await expect(resendInvitation(outsider, org, id)).rejects.toBeInstanceOf(
    ForbiddenError,
  );

  await resendInvitation(owner, org, id);
  const live = await getPendingInvitation(id);
  expect(live).not.toBeNull(); // the same link works again
  const [row] = await db.select().from(invitation).where(eq(invitation.id, id));
  const days = (row.expiresAt.getTime() - Date.now()) / 86_400_000;
  expect(days).toBeGreaterThan(6.9);
  expect(days).toBeLessThanOrEqual(7);

  // Accepted or cancelled invites can't be resurrected by a resend.
  await db
    .update(invitation)
    .set({ status: "canceled" })
    .where(eq(invitation.id, id));
  await expect(resendInvitation(owner, org, id)).rejects.toBeInstanceOf(
    NotFoundError,
  );
});
