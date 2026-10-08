import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { listAuditEvents } from "@/lib/audit";
import { ForbiddenError } from "@/lib/errors";
import { requireSession } from "@/lib/session";
import { cn } from "@/lib/utils";

const PAGE = 50;

const AREAS: { id: string; label: string }[] = [
  { id: "", label: "Everything" },
  { id: "task", label: "Tasks" },
  { id: "document", label: "Documents" },
  { id: "client", label: "Client decisions" },
  { id: "role", label: "Roles" },
  { id: "member", label: "People" },
  { id: "invitation", label: "Invitations" },
  { id: "project", label: "Projects" },
  { id: "webhook", label: "Webhooks" },
  { id: "ai", label: "AI" },
];

const VERB: Record<string, string> = {
  "task.created": "created task",
  "task.updated": "edited task",
  "task.deleted": "deleted task",
  "task.submitted": "submitted work on",
  "task.submission_retracted": "took back their submission on",
  "task.approved": "approved",
  "task.rejected": "sent back",
  "document.created": "created document",
  "document.updated": "saved a new version of",
  "document.deleted": "deleted document",
  "document.shared": "made a client link for",
  "document.share_revoked": "revoked the client link for",
  "client.approved": "approved",
  "client.changes_requested": "asked for changes to",
  "role.created": "created role",
  "role.updated": "changed permissions of role",
  "role.deleted": "deleted role",
  "member.role_changed": "changed the role of",
  "invitation.created": "invited",
  "invitation.cancelled": "cancelled the invitation for",
  "invitation.resent": "re-sent the invitation to",
  "invitation.accepted": "accepted the invitation for",
  "project.created": "created project",
  "project.member_added": "put someone on the project",
  "project.member_removed": "took someone off the project",
  "project.github_linked": "linked GitHub repository",
  "ai.key_saved": "connected a provider key for",
  "ai.key_removed": "removed the provider key for",
  "ai.settings_changed": "changed the default AI model",
  "webhook.created": "added webhook",
  "webhook.deleted": "removed webhook",
  "webhook.updated": "edited webhook",
  "webhook.paused": "paused webhook",
  "webhook.resumed": "resumed webhook",
};

/** The one line that matters from the event's detail. */
function extra(action: string, d: Record<string, unknown>) {
  if (action === "member.role_changed") return `${d.from} → ${d.to}`;
  if (action === "role.updated")
    return `${(d.before as string[]).length} → ${(d.after as string[]).length} permissions`;
  if (action === "task.rejected" && typeof d.note === "string") return d.note;
  if (action === "client.changes_requested" && typeof d.note === "string")
    return d.note;
  if (typeof d.version === "number") return `v${d.version}`;
  if (action.startsWith("project.member") && typeof d.role === "string")
    return `as ${d.role}`;
  if (action === "invitation.created" && typeof d.role === "string")
    return `as ${d.role}`;
  return null;
}

export default async function ActivityPage({
  searchParams,
}: PageProps<"/activity">) {
  const sp = await searchParams;
  const { user, session } = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId) redirect("/");
  const area = typeof sp.area === "string" && sp.area ? sp.area : undefined;
  const before =
    typeof sp.before === "string" && !Number.isNaN(Date.parse(sp.before))
      ? new Date(sp.before)
      : undefined;

  const events = await listAuditEvents(user.id, orgId, {
    area,
    before,
    limit: PAGE + 1,
  }).catch((e) => {
    if (e instanceof ForbiddenError) redirect("/");
    throw e;
  });
  const shown = events.slice(0, PAGE);
  // ponytail: cursor is millisecond-precise; rows sharing a millisecond at a page edge could repeat. Cursor on (time, id) if it matters.
  const older = events.length > PAGE ? shown[shown.length - 1] : null;

  return (
    <main className="flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="mt-1 text-muted-foreground">
          Who did what, newest first. Entries can&apos;t be edited or deleted.
        </p>
      </div>

      <nav aria-label="Filter" className="flex flex-wrap gap-1.5">
        {AREAS.map((a) => (
          <Link
            key={a.id}
            href={a.id ? `/activity?area=${a.id}` : "/activity"}
            aria-current={(area ?? "") === a.id ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors hover:bg-accent",
              (area ?? "") === a.id &&
                "border-primary/50 bg-primary/10 text-primary",
            )}
          >
            {a.label}
          </Link>
        ))}
      </nav>

      {shown.length === 0 ? (
        <p className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
          Nothing recorded here yet.
        </p>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {shown.map((e) => {
            const note = extra(e.action, e.detail);
            return (
              <li
                key={e.id}
                className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between"
              >
                <span className="min-w-0 text-sm">
                  <span className="font-medium">{e.actorLabel}</span>
                  {e.actorId === null && (
                    <Badge variant="outline" className="mx-1.5">
                      client
                    </Badge>
                  )}{" "}
                  {VERB[e.action] ?? e.action}
                  {e.targetLabel && (
                    <>
                      {" "}
                      <span className="font-medium">{e.targetLabel}</span>
                    </>
                  )}
                  {note && (
                    <span className="text-muted-foreground"> · {note}</span>
                  )}
                </span>
                <time
                  dateTime={e.createdAt.toISOString()}
                  className="shrink-0 text-xs text-muted-foreground"
                >
                  {e.createdAt.toLocaleString("en-GB", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "UTC",
                  })}{" "}
                  UTC
                </time>
              </li>
            );
          })}
        </ul>
      )}

      {older && (
        <Link
          href={`/activity?${area ? `area=${area}&` : ""}before=${encodeURIComponent(older.createdAt.toISOString())}`}
          className="self-start text-sm text-primary hover:underline"
        >
          Older
        </Link>
      )}
    </main>
  );
}
