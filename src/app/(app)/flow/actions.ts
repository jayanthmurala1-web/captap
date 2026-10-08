"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DomainError } from "@/lib/errors";
import { setRoleRoutes } from "@/lib/role-routing";
import { requireSession } from "@/lib/session";

export type FormState = { error?: string; ok?: boolean } | undefined;

const routesInput = z.array(
  z.object({
    role: z.enum(["product", "developer", "qa", "devops"]),
    skillName: z.string().min(1),
  }),
);

export async function saveRoleRoutesAction(
  routes: z.infer<typeof routesInput>,
): Promise<FormState> {
  const { user, session } = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId) return { error: "No active organization" };
  const parsed = routesInput.safeParse(routes);
  if (!parsed.success) return { error: "Invalid routes" };
  try {
    await setRoleRoutes(user.id, orgId, parsed.data);
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath("/flow");
  return { ok: true };
}
