import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { jwt, organization } from "better-auth/plugins";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { member } from "@/db/schema";
import { sendEmail, verifyEmailMessage } from "@/lib/email";
import { seedDefaultRoles } from "@/lib/roles";

const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
export const mcpResource = `${baseURL}/api/mcp`;

// Opt-in, for deployments that can actually send email (the hosted service). Self-hosters and the
// Docker trial have no mail provider, and requiring verification there would lock everyone out.
const requireVerification = process.env.REQUIRE_EMAIL_VERIFICATION === "1";
if (requireVerification && !process.env.RESEND_API_KEY)
  throw new Error(
    "REQUIRE_EMAIL_VERIFICATION=1 needs RESEND_API_KEY: without email nobody could ever verify.",
  );

export const auth = betterAuth({
  baseURL,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: requireVerification,
  },
  emailVerification: {
    // sendOnSignIn: an unverified account (incl. ones created before this was switched on) gets a
    // fresh link when it tries to sign in, instead of being stuck.
    sendOnSignUp: requireVerification,
    sendOnSignIn: requireVerification,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({ to: user.email, ...verifyEmailMessage({ link: url }) });
    },
  },
  databaseHooks: {
    session: {
      create: {
        // Returning users land in their first org instead of an empty state.
        before: async (session) => {
          const [m] = await db
            .select({ orgId: member.organizationId })
            .from(member)
            .where(eq(member.userId, session.userId))
            .orderBy(asc(member.createdAt))
            .limit(1);
          return {
            data: { ...session, activeOrganizationId: m?.orgId ?? null },
          };
        },
      },
    },
  },
  hooks: {
    // RFC 8252: loopback redirects mean a native app. Many MCP clients omit application_type,
    // and Better Auth's "web" default would reject their http://localhost callbacks (ADR-007).
    before: createAuthMiddleware(async (ctx) => {
      const body = ctx.body as
        | { application_type?: string; redirect_uris?: string[] }
        | undefined;
      if (
        ctx.path !== "/oauth2/register" ||
        !body ||
        body.application_type ||
        !body.redirect_uris?.length
      )
        return;
      const loopback = body.redirect_uris.every((u) =>
        /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(u),
      );
      if (loopback)
        return {
          context: { ...ctx, body: { ...body, application_type: "native" } },
        };
    }),
  },
  // Sign-in/up brute force: Better Auth's own limiter (stricter built-in rules for credentials
  // endpoints), stored in Postgres so it holds across serverless instances (spec 019).
  rateLimit: { enabled: true, storage: "database", window: 60, max: 100 },
  disabledPaths: [
    "/token", // the OAuth provider owns /oauth2/token; the JWT plugin's /token would conflict
    // Membership and roles are managed by src/lib/roles.ts + invitations.ts (spec 016). Better Auth's own
    // versions only understand its three built-in roles, so leaving them reachable would bypass org-defined roles.
    ...[
      "create-role",
      "update-role",
      "delete-role",
      "invite-member",
      "accept-invitation",
      "reject-invitation",
      "cancel-invitation",
      "remove-member",
      "update-member-role",
      "leave",
      "update",
      "delete",
    ].map((p) => `/organization/${p}`),
  ],
  plugins: [
    organization({
      organizationHooks: {
        afterCreateOrganization: async ({ organization }) => {
          // No default skill rows written here (spec 025/026): Flow starts blank, built up
          // explicitly via "+ Add agent". availableAgents()/effectiveRoleSkills() still fall
          // back to the built-in defaults on their own, so Consult and task-matching still
          // work out of the box even with zero real rows.
          await seedDefaultRoles(organization.id);
        },
      },
    }),
    jwt(),
    mcp({
      loginPage: "/sign-in",
      consentPage: "/consent",
      resource: mcpResource,
      // Claude Code / Cursor still register via DCR; CIMD covers MCP 2026-07-28 clients.
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
    }),
    cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
    nextCookies(), // must stay last
  ],
});
