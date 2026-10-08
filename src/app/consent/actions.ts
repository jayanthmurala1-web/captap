"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { oauthClient } from "@/db/schema";

export async function getClientInfo(
  clientId: string,
): Promise<{ name: string | null; icon: string | null }> {
  if (!clientId) return { name: null, icon: null };
  const [row] = await db
    .select({ name: oauthClient.name, icon: oauthClient.icon })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, clientId))
    .limit(1);
  return {
    name: row?.name ?? null,
    icon: row?.icon ?? null,
  };
}
