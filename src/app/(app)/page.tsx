import { CircleAlert, FolderGit2, Inbox } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { listProjectApprovals } from "@/lib/document-share";
import { listProjectSummaries } from "@/lib/projects";
import { requireSession } from "@/lib/session";
import { formatDateShort } from "@/lib/utils";
import { NewProjectDialog } from "./new-project-dialog";
import { SampleProjectButton } from "./sample-project-button";

export default async function Home() {
  const { user, session } = await requireSession();
  const orgId = session.activeOrganizationId;
  // The layout shows workspace setup when there is no active org.
  if (!orgId) return null;

  const projects = await listProjectSummaries(user.id, orgId);
  // Client decisions are admin-only; for everyone else this is just empty.
  // ponytail: one approvals query per project; fine for an agency's handful of clients.
  const approvals = await Promise.all(
    projects.map((p) => listProjectApprovals(user.id, p.id).catch(() => [])),
  );
  const attentionByProject = new Map(
    projects.map((p, i) => [
      p.id,
      approvals[i].filter(
        (a) => a.stale || a.latest?.decision === "changes_requested",
      ).length,
    ]),
  );
  const toReview = projects.reduce((n, p) => n + p.inReview, 0);
  const clientAttention = [...attentionByProject.values()].reduce(
    (a, b) => a + b,
    0,
  );

  return (
    <main className="flex w-full flex-col gap-6 px-4 py-8 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-muted-foreground">
            Every client project, what&apos;s waiting on you, and where each one
            stands.
          </p>
        </div>
        {projects.length > 0 && <NewProjectDialog />}
      </div>

      {(toReview > 0 || clientAttention > 0) && (
        <div className="flex flex-wrap gap-3">
          {toReview > 0 && (
            <p className="flex items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm">
              <Inbox className="size-4 text-primary" />
              <span>
                <strong>{toReview}</strong> {toReview === 1 ? "task" : "tasks"}{" "}
                waiting for your review
              </span>
            </p>
          )}
          {clientAttention > 0 && (
            <p className="flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
              <CircleAlert className="size-4 text-warning" />
              <span>
                <strong>{clientAttention}</strong> client{" "}
                {clientAttention === 1 ? "approval needs" : "approvals need"}{" "}
                attention
              </span>
            </p>
          )}
        </div>
      )}

      {projects.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed p-8">
          <p className="text-lg font-medium">
            Start with your first client project
          </p>
          <p className="max-w-md text-muted-foreground">
            Add the PRD your client agreed to, share it for sign-off, and every
            task your agents submit gets checked against it.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <NewProjectDialog size="default" />
            <SampleProjectButton />
          </div>
          <p className="text-sm text-muted-foreground">
            Not sure yet? The sample is a made-up project showing a
            client-approved PRD and an agent's work that misses one of its
            requirements.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => {
            const attention = attentionByProject.get(p.id) ?? 0;
            return (
              <li key={p.id}>
                <Link
                  href={`/projects/${p.id}`}
                  className="flex h-full flex-col gap-4 rounded-2xl border bg-card p-5 transition-colors hover:border-primary/40"
                >
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold">{p.name}</h2>
                    <p className="mt-1 line-clamp-2 min-h-10 text-sm text-muted-foreground">
                      {p.description || "No description"}
                    </p>
                  </div>

                  {p.total ? (
                    <div>
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="text-2xl font-semibold tabular-nums">
                          {p.percentDone}%
                        </span>
                        <span className="text-muted-foreground">
                          {p.done} of {p.total} tasks done
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${p.percentDone}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No tasks yet. Start with the PRD.
                    </p>
                  )}

                  <div className="flex min-h-5 flex-wrap gap-1.5">
                    {p.inReview > 0 && <Badge>{p.inReview} to review</Badge>}
                    {attention > 0 && (
                      <Badge variant="warning">
                        {attention} client{" "}
                        {attention === 1 ? "approval" : "approvals"}
                      </Badge>
                    )}
                    {p.inProgress > 0 && (
                      <Badge variant="secondary">
                        {p.inProgress} in progress
                      </Badge>
                    )}
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {p.githubRepo ? (
                        <>
                          <FolderGit2 className="size-3.5 shrink-0" />
                          <span className="truncate font-mono">
                            {p.githubRepo}
                          </span>
                        </>
                      ) : (
                        "No repo linked"
                      )}
                    </span>
                    <span className="shrink-0">
                      {p.lastActivity
                        ? `Active ${formatDateShort(p.lastActivity)}`
                        : `Created ${formatDateShort(p.createdAt)}`}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
