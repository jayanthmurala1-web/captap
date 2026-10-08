"use server";

import { requireCapability } from "@/lib/access";
import { describeModelAccess, listOrgKeyModels } from "@/lib/ai/model-access";
import { DomainError } from "@/lib/errors";
import { requireSession } from "@/lib/session";
import { availableAgents } from "@/lib/skills";
import { getTask } from "@/lib/tasks";

export type ConsultSetup =
  | {
      ok: true;
      agents: { name: string; kind: "guide" | "review"; description: string }[];
      /** The agent a task points to (assigned, else role-matched), when opened from a task. */
      defaultAgent: string | null;
      access: Awaited<ReturnType<typeof describeModelAccess>>;
      canManageKeys: boolean;
    }
  | { ok: false; error: string };

/** What the Consult panel needs to open: this scope's agents, the task's agent, and the usable models. */
export async function consultSetupAction(input: {
  projectId?: string;
  taskId?: string;
}): Promise<ConsultSetup> {
  const { user, session } = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId) return { ok: false, error: "No active workspace" };
  try {
    await requireCapability(user.id, orgId, "use_ai");
    const task = input.taskId ? await getTask(user.id, input.taskId) : null;
    const scope = task
      ? { projectId: task.projectId }
      : input.projectId
        ? { projectId: input.projectId }
        : { orgId };
    const [agents, access, canManageKeys] = await Promise.all([
      availableAgents(user.id, scope),
      describeModelAccess(user.id, orgId),
      requireCapability(user.id, orgId, "manage_ai_keys").then(
        () => true,
        () => false,
      ),
    ]);
    return {
      ok: true,
      agents: agents
        .map((a) => ({
          name: a.name,
          kind: a.kind,
          description: a.description,
        }))
        .sort(
          (a, b) =>
            Number(a.kind === "review") - Number(b.kind === "review") ||
            a.name.localeCompare(b.name),
        ),
      defaultAgent: task
        ? (task.assignedSkill ?? task.matchedSkills[0]?.name ?? null)
        : null,
      access,
      canManageKeys,
    };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: e.message };
    throw e;
  }
}

/** Models the org's own provider keys can call (network calls to each provider; only when the picker opens). */
export async function ownKeyModelsAction() {
  const { user, session } = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId) return [];
  try {
    return await listOrgKeyModels(user.id, orgId);
  } catch (e) {
    if (e instanceof DomainError) return [];
    throw e;
  }
}
