import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { capabilitiesOf } from "@/lib/access";
import { listPendingInvitations } from "@/lib/invitations";
import { getOrgName } from "@/lib/projects";
import { listRoles } from "@/lib/roles";
import { requireSession } from "@/lib/session";
import { listMembers } from "@/lib/tasks";
import { cancelInvitationAction } from "../actions";
import { CopyInviteLink, InviteForm, ResendInvite } from "./invite-form";
import {
  LeaveOrgButton,
  RemoveMemberButton,
  RenameOrgForm,
} from "./member-actions";
import { MemberRoleSelect, RolesPanel } from "./roles-panel";

export default async function MembersPage() {
  const { user, session } = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId) return null;

  const [orgName, members, roles] = await Promise.all([
    getOrgName(user.id, orgId),
    listMembers(user.id, orgId),
    listRoles(user.id, orgId),
  ]);
  const myRole = members.find((m) => m.id === user.id)?.role ?? "";
  const caps = await capabilitiesOf(orgId, myRole);
  const canManageRoles = caps.has("manage_roles");
  const canManageOrg = caps.has("manage_org_settings");
  const roleName = (slug: string | null) =>
    roles.find((r) => r.slug === (slug ?? "member"))?.name ?? slug;
  // Needs "Invite people"; without it this is null and the invite UI is hidden.
  const invitations = caps.has("invite_members")
    ? await listPendingInvitations(user.id, orgId)
    : null;
  const isAdmin = invitations !== null;
  const sorted = [...members].sort(
    (a, b) =>
      Number(b.id === user.id) - Number(a.id === user.id) ||
      (a.name ?? "").localeCompare(b.name ?? ""),
  );

  return (
    <main className="flex w-full max-w-4xl flex-col gap-8 px-4 py-8 sm:px-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <p className="mt-1 text-muted-foreground">
          Everyone in {orgName ?? "this workspace"}. What each person can do
          comes from their role.
        </p>
      </div>

      {isAdmin && (
        <section className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
          <div>
            <h2 className="font-semibold">Invite someone</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              We email them a link. Only that email address can use it, and it
              expires after 7 days.
            </p>
          </div>
          <InviteForm roles={roles.filter((r) => r.slug !== "owner")} />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">
          Members{" "}
          <span className="text-muted-foreground">{members.length}</span>
        </h2>
        <ul className="divide-y rounded-2xl border bg-card">
          {sorted.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-4 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold uppercase text-primary">
                {(m.name || m.email).slice(0, 2)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 font-medium">
                  <span className="truncate">{m.name}</span>
                  {m.id === user.id && (
                    <span className="text-xs font-normal text-muted-foreground">
                      you
                    </span>
                  )}
                </span>
                <span className="block truncate text-sm text-muted-foreground">
                  {m.email}
                </span>
              </span>
              {canManageRoles && m.id !== user.id ? (
                <MemberRoleSelect userId={m.id} slug={m.role} roles={roles} />
              ) : (
                <Badge variant={m.role === "member" ? "secondary" : "outline"}>
                  {roleName(m.role)}
                </Badge>
              )}
              {canManageRoles && m.id !== user.id && (
                <RemoveMemberButton userId={m.id} name={m.name || m.email} />
              )}
            </li>
          ))}
        </ul>
      </section>

      {isAdmin && invitations.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">
            Waiting to join{" "}
            <span className="text-muted-foreground">{invitations.length}</span>
          </h2>
          <ul className="divide-y rounded-2xl border bg-card">
            {invitations.map((inv) => {
              const days = Math.max(
                1,
                Math.ceil((inv.expiresAt.getTime() - Date.now()) / 86_400_000),
              );
              return (
                <li
                  key={inv.id}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {inv.email}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {roleName(inv.role)} · expires in {days}{" "}
                      {days === 1 ? "day" : "days"}
                    </span>
                  </span>
                  <span className="flex gap-2">
                    <ResendInvite invitationId={inv.id} />
                    <CopyInviteLink invitationId={inv.id} />
                    <form action={cancelInvitationAction}>
                      <input type="hidden" name="invitationId" value={inv.id} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                      >
                        Revoke
                      </Button>
                    </form>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {canManageRoles && <RolesPanel roles={roles} />}

      <section className="flex flex-col gap-4 rounded-2xl border bg-card p-5">
        <div>
          <h2 className="font-semibold">Workspace</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The name your clients see when you send them something to approve.
          </p>
        </div>
        {canManageOrg ? (
          <RenameOrgForm orgName={orgName ?? ""} />
        ) : (
          <p className="text-sm">
            <span className="text-muted-foreground">Name: </span>
            {orgName}
          </p>
        )}
        <div className="flex flex-col gap-2 border-t pt-4">
          <p className="text-sm text-muted-foreground">
            Leaving removes your access to this workspace&apos;s projects. Work
            you&apos;d claimed goes back to To do and anything assigned to you
            becomes unassigned.
          </p>
          <LeaveOrgButton />
        </div>
      </section>
    </main>
  );
}
