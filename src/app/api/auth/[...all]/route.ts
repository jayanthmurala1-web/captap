import { randomBytes, randomUUID } from "node:crypto";
import { toNextJsHandler } from "better-auth/next-js";
import { db } from "@/db";
import { oauthClient, oauthClientResource, oauthResource } from "@/db/schema";
import { auth } from "@/lib/auth";

const handlers = toNextJsHandler(auth);

export const GET = handlers.GET;

export async function POST(req: Request) {
  const url = new URL(req.url);
  if (url.pathname.endsWith("/oauth2/register")) {
    try {
      const clone = req.clone();
      const body = await clone.json();
      const hasCustomScheme = body?.redirect_uris?.some((uri: string) =>
        /^cursor:\/\/|^vscode:\/\//i.test(uri),
      );
      if (hasCustomScheme) {
        const clientId = randomBytes(16).toString("hex");
        const redirectUris = body.redirect_uris as string[];
        const name = body.client_name || "Cursor";

        await db.insert(oauthClient).values({
          id: randomUUID(),
          clientId,
          name,
          redirectUris,
          applicationType: "native",
          grantTypes: ["authorization_code", "refresh_token"],
          responseTypes: ["code"],
          tokenEndpointAuthMethod: body.token_endpoint_auth_method || "none",
          requirePKCE: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // Link client to all OAuth resources so authorization doesn't fail with invalid_target
        const resources = await db.select().from(oauthResource);
        for (const res of resources) {
          await db
            .insert(oauthClientResource)
            .values({
              id: randomUUID(),
              clientId,
              resourceId: res.identifier,
              createdAt: new Date(),
            })
            .onConflictDoNothing();
        }

        return Response.json(
          {
            client_id: clientId,
            client_name: name,
            redirect_uris: redirectUris,
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            token_endpoint_auth_method:
              body.token_endpoint_auth_method || "none",
            application_type: "native",
          },
          { status: 201 },
        );
      }
    } catch (e) {
      console.error("Custom client registration error:", e);
    }
  }
  return handlers.POST(req);
}
