import { FileText } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { docTypeLabel } from "@/lib/doc-types";
import { listProjectApprovals } from "@/lib/document-share";
import { listDocuments } from "@/lib/documents";
import { requireSession } from "@/lib/session";
import { cn, formatDateShort } from "@/lib/utils";
import { NewDocumentDialog } from "./new-document-dialog";

const LEDGER = "work_ledger";

export default async function ProjectDocumentsPage({
  params,
  searchParams,
}: PageProps<"/projects/[id]/documents">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { user } = await requireSession();
  const [documents, approvals] = await Promise.all([
    listDocuments(user.id, id),
    // Admin-only; members see the list without client decisions.
    listProjectApprovals(user.id, id).catch(() => []),
  ]);
  const approvalByDoc = new Map(approvals.map((a) => [a.documentId, a]));

  const type = typeof sp.type === "string" ? sp.type : "all";
  // Work ledgers are auto-created per developer; keep them out of "All".
  const shown = documents.filter((d) =>
    type === "all" ? d.docType !== LEDGER : d.docType === type,
  );
  const counts = new Map<string, number>();
  for (const d of documents)
    counts.set(d.docType, (counts.get(d.docType) ?? 0) + 1);
  const types = [...counts.keys()].sort((a, b) =>
    a === "prd"
      ? -1
      : b === "prd"
        ? 1
        : a === LEDGER
          ? 1
          : b === LEDGER
            ? -1
            : docTypeLabel(a).localeCompare(docTypeLabel(b)),
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Documents</h2>
        <NewDocumentDialog projectId={id} />
      </div>

      {documents.length > 0 && (
        <nav aria-label="Filter by type" className="flex flex-wrap gap-2">
          <Chip href={`/projects/${id}/documents`} active={type === "all"}>
            All
          </Chip>
          {types.map((t) => (
            <Chip
              key={t}
              href={`/projects/${id}/documents?type=${t}`}
              active={type === t}
            >
              {docTypeLabel(t)}{" "}
              <span className="text-muted-foreground">{counts.get(t)}</span>
            </Chip>
          ))}
        </nav>
      )}

      {shown.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-2xl border border-dashed p-8">
          <FileText className="size-5 text-primary" />
          <p className="font-medium">No documents yet</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Start with a PRD. It&apos;s what tasks are checked against and what
            your client approves.
          </p>
        </div>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {shown.map((d) => {
            const a = approvalByDoc.get(d.id);
            return (
              <li key={d.id}>
                <Link
                  href={`/documents/${d.id}`}
                  className="flex flex-col gap-2 px-4 py-3.5 transition-colors hover:bg-accent/50 sm:flex-row sm:items-center sm:justify-between sm:px-5"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {d.title}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {docTypeLabel(d.docType)} · v{d.currentVersion} ·{" "}
                      {d.visibility === "published" ? "Published" : "Draft"} ·
                      updated {formatDateShort(d.updatedAt)}
                    </span>
                  </span>
                  {a && <ApprovalBadge a={a} />}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ApprovalBadge({
  a,
}: {
  a: Awaited<ReturnType<typeof listProjectApprovals>>[number];
}) {
  if (!a.latest) return <Badge variant="secondary">Awaiting client</Badge>;
  if (a.latest.decision === "changes_requested")
    return <Badge variant="warning">Changes requested</Badge>;
  if (a.stale)
    return (
      <Badge variant="warning">
        Approved v{a.latest.version} · changed since
      </Badge>
    );
  return <Badge variant="success">Client approved</Badge>;
}

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-full border px-3 py-1 text-sm transition-colors hover:bg-accent",
        active && "border-primary/50 bg-primary/10 text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
