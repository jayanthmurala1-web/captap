import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { member, organization, user } from "@/db/schema";
import { seedDefaultRoles } from "./roles";

/** Minimal PRD content that passes validatePrdStructure (spec 011) — for tests that need a real PRD document, not testing its structure. */
export const validPrd = `
## Problem & Context
${Array(55).fill("word").join(" ")}

## Non-Goals
- Not doing mobile apps
- Not doing SSO in v1

## Acceptance Criteria
- Given a user signs up, when they confirm email, then account is active.
`;

/** Creates throwaway users and orgs in the dev DB; `cleanup` cascades everything they own. */
export function fixtures() {
  const run = randomUUID().slice(0, 8);
  const users: string[] = [];
  const orgs: string[] = [];
  const now = new Date();

  return {
    async user(tag: string) {
      const id = `test-${tag}-${run}`;
      await db.insert(user).values({
        id,
        name: id,
        email: `${id}@test.local`,
        emailVerified: false,
        createdAt: now,
        updatedAt: now,
      });
      users.push(id);
      return id;
    },
    async org(tag: string, members: Record<string, string>) {
      const id = `test-${tag}-${run}`;
      await db
        .insert(organization)
        .values({ id, name: id, slug: id, createdAt: now });
      await seedDefaultRoles(id);
      await db.insert(member).values(
        Object.entries(members).map(([userId, role]) => ({
          id: `${id}-${userId}`,
          organizationId: id,
          userId,
          role,
          createdAt: now,
        })),
      );
      orgs.push(id);
      return id;
    },
    async cleanup() {
      if (orgs.length)
        await db.delete(organization).where(inArray(organization.id, orgs));
      if (users.length) await db.delete(user).where(inArray(user.id, users));
    },
  };
}
