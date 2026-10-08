import { CircleAlert, Link2 } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { listProjectApprovals } from "@/lib/document-share";
import { ForbiddenError } from "@/lib/errors";
import { requireSession } from "@/lib/session";
import { formatDateShort } from "@/lib/utils";

type Row = Awaited<ReturnType<typeof listProjectApprovals>>[number];

export default async function ProjectApprovalsPage({
  params,
}: PageProps<"/projects/[id]/approvals">) {
  const { id } = await params;
  const { user } = await requireSession();
  const rows = await listProjectApprovals(user.id, id).catch((e) => {
    if (e instanceof ForbiddenError) return null;
    throw e;
  });

  if (rows === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Only project leads and org admins can see client approvals.
      </p>
    );
  }

  const approved = rows.filter(
    (r) => r.latest?.decision === "approved" && !r.stale,
  ).length;
  const attention = rows.filter(
    (r) => r.stale || r.latest?.decision === "changes_requested",
  ).length;
  const waiting = rows.filter((r) => !r.latest).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Client approvals</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Every document you&apos;ve shared with a client and what they decided.
          Each decision is pinned to the exact version the client saw.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed p-8">
          <Link2 className="size-5 text-primary" />
          <p className="font-medium">Nothing shared with a client yet</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Open a document and create a share link. Your client can read it and
            approve or request changes, with no account needed.
          </p>
          <Link
            href={`/projects/${id}/documents`}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Go to documents
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Approved & current" value={approved} />
            <Stat label="Need attention" value={attention} tone="warning" />
            <Stat label="Awaiting client" value={waiting} />
          </div>
          <ul className="flex flex-col gap-3">
            {rows.map((r) => (
              <ApprovalRow key={r.documentId} row={r} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warning";
}) {
  return (
    <div className="rounded-2xl border bg-card p-4 sm:p-5">
      <p
        className={`text-3xl font-semibold tabular-nums sm:text-4xl ${tone && value > 0 ? "text-warning" : ""}`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{label}</p>
    </div>
  );
}

function ApprovalRow({ row }: { row: Row }) {
  const { latest } = row;
  return (
    <li className="rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/documents/${row.documentId}`}
            className="font-medium hover:underline"
          >
            {row.title}
          </Link>
          <p className="mt-1 text-sm text-muted-foreground">
            {latest
              ? `v${latest.version} · ${latest.approverName} · ${formatDateShort(latest.createdAt)}`
              : `Shared v${row.currentVersion} · no response yet`}
            {row.activeShares === 0 && " · link revoked"}
          </p>
        </div>
        {!latest ? (
          <Badge variant="secondary">Awaiting client</Badge>
        ) : latest.decision === "approved" ? (
          <Badge variant="success">Approved</Badge>
        ) : (
          <Badge variant="warning">Changes requested</Badge>
        )}
      </div>

      {latest?.decision === "changes_requested" && latest.note && (
        <blockquote className="mt-3 border-l-2 border-warning/60 pl-3 text-sm text-foreground/85">
          {latest.note}
        </blockquote>
      )}

      {row.stale && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          The document is now v{row.currentVersion}; the client&apos;s decision
          covers v{latest?.version}. Share again before relying on it.
        </p>
      )}
    </li>
  );
}
