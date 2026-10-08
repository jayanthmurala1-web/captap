import { redirect } from "next/navigation";
import { capabilitiesOf, requireMember } from "@/lib/access";
import { getEffectiveRoleRoutes, TASK_ROLES } from "@/lib/role-routing";
import { requireSession } from "@/lib/session";
import { splitSkill } from "@/lib/skill-parser";
import { getEffectiveSkills } from "@/lib/skills";
import { FlowCanvas } from "./flow-canvas";

export default async function FlowPage() {
  const { user, session } = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId) redirect("/");
  const role = await requireMember(user.id, orgId);
  const canEdit = (await capabilitiesOf(orgId, role)).has(
    "manage_org_settings",
  );

  // Real rows only — no fallback to the built-in defaults here. The canvas should show exactly
  // what this org has actually added, nothing invented to fill empty space.
  const [skills, effective] = await Promise.all([
    getEffectiveSkills(user.id, { orgId }),
    getEffectiveRoleRoutes(user.id, orgId),
  ]);

  const agents = skills.map((s) => {
    const { description, body } = splitSkill(s.source);
    return { id: s.id, name: s.name, description, body, kind: s.kind };
  });

  return (
    <main className="flex h-[calc(100dvh-1px)] w-full flex-col">
      <div className="border-b px-4 py-5 sm:px-8">
        <h1 className="text-2xl font-semibold tracking-tight">Flow</h1>
        <p className="mt-1 text-muted-foreground">
          Your org&apos;s agents, and which role each one handles. Add an agent,
          then drag a connection from it to a role to route tasks of that role
          to it — this doesn&apos;t run anything, it just decides what gets
          attached automatically.
        </p>
      </div>
      <div className="min-h-0 flex-1">
        <FlowCanvas
          agents={agents}
          roles={TASK_ROLES}
          routes={effective.routes}
          canEdit={canEdit}
        />
      </div>
    </main>
  );
}
