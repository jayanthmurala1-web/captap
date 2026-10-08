import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ConsultDrawer } from "@/components/consult-drawer";
import { capabilitiesOf, ForbiddenError, requireMember } from "@/lib/access";
import { auth } from "@/lib/auth";
import { getOrgName, listOrganizations, listProjects } from "@/lib/projects";
import { requireSession } from "@/lib/session";
import { CreateOrg } from "./create-org";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { user, session } = await requireSession();
  const orgId = session.activeOrganizationId;
  // No workspace yet: nothing else in the app means anything, so every route shows setup.
  if (!orgId) return <CreateOrg email={user.email} />;

  let role: string;
  try {
    role = await requireMember(user.id, orgId);
  } catch (e) {
    // Stale active org (left it, or an admin removed you) — don't crash the whole shell on it.
    if (!(e instanceof ForbiddenError)) throw e;
    const orgs = await listOrganizations(user.id);
    if (orgs[0]) {
      await auth.api.setActiveOrganization({
        body: { organizationId: orgs[0].id },
        headers: await headers(),
      });
      redirect("/");
    }
    return <CreateOrg email={user.email} />;
  }

  const [orgName, projects, caps, orgs] = await Promise.all([
    getOrgName(user.id, orgId),
    listProjects(user.id, orgId),
    capabilitiesOf(orgId, role),
    listOrganizations(user.id),
  ]);

  return (
    <AppShell
      user={user}
      orgName={orgName}
      orgs={orgs}
      activeOrgId={orgId}
      projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      canViewActivity={caps.has("view_audit_log")}
      canManageOrg={caps.has("manage_org_settings")}
    >
      {children}
      <ConsultDrawer />
    </AppShell>
  );
}
