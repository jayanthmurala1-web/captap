import { ChevronRight, History } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocContent } from "@/components/doc-content";
import { Badge } from "@/components/ui/badge";
import { docTypeLabel } from "@/lib/doc-types";
import { getApprovalStatus, listDocumentShares } from "@/lib/document-share";
import { getDeleteImpact, getDocument, listVersions } from "@/lib/documents";
import { stripErdBlock } from "@/lib/erd";
import { NotFoundError } from "@/lib/errors";
import { figmaEmbedFromContent } from "@/lib/figma";
import { getProject } from "@/lib/projects";
import { listRequirements } from "@/lib/requirements";
import { requireSession } from "@/lib/session";
import { cn, formatDateShort } from "@/lib/utils";
import { ClientApprovalPanel } from "../client-approval-panel";
import { DeleteDocument } from "./delete-document";
import { DocumentBody } from "./document-body";
import { ErdCanvas } from "./erd-canvas";
import { RequirementsPanel } from "./requirements-panel";

export default async function DocumentPage({
  params,
  searchParams,
}: PageProps<"/documents/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { user } = await requireSession();
  const requested = Number(sp.v) || undefined;
  const [doc, versions] = await Promise.all([
    getDocument(user.id, id, requested),
    listVersions(user.id, id),
  ]).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const [project, approval, shares, reqs, deleteImpact] = await Promise.all([
    getProject(user.id, doc.projectId),
    // Share links and client decisions are admin-only; members just don't see the panel.
    getApprovalStatus(user.id, id).catch(() => null),
    listDocumentShares(user.id, id).catch(() => null),
    doc.docType === "prd" ? listRequirements(user.id, id) : null,
    getDeleteImpact(user.id, id),
  ]);

  const isLatest = doc.version === doc.currentVersion;
  const figma = figmaEmbedFromContent(doc.content);
  const isErd = doc.docType === "erd" || doc.content.includes("erDiagram");

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="border-b px-4 pt-5 pb-5 sm:px-8">
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-1 text-sm text-muted-foreground"
        >
          <Link
            href={`/projects/${project.id}`}
            className="truncate hover:text-foreground"
          >
            {project.name}
          </Link>
          <ChevronRight className="size-3.5 shrink-0" />
          <Link
            href={`/projects/${project.id}/documents`}
            className="hover:text-foreground"
          >
            Documents
          </Link>
        </nav>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{doc.title}</h1>
          {isLatest && deleteImpact.canDelete && (
            <DeleteDocument
              id={doc.id}
              title={doc.title}
              approvalCount={deleteImpact.approvalCount}
              linkedTaskCount={deleteImpact.linkedTaskCount}
            />
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="outline">{docTypeLabel(doc.docType)}</Badge>
          <Badge
            variant={doc.visibility === "published" ? "success" : "secondary"}
          >
            {doc.visibility === "published" ? "Published" : "Draft"}
          </Badge>
          <span className="text-muted-foreground">
            v{doc.version} · updated {formatDateShort(doc.updatedAt)}
          </span>
        </div>
      </header>

      <div className="grid min-w-0 gap-8 px-4 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          {!isLatest && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
              <span>
                You&apos;re viewing <strong>v{doc.version}</strong>. The latest
                is v{doc.currentVersion}.
              </span>
              <Link
                href={`/documents/${doc.id}`}
                className="font-medium text-primary hover:underline"
              >
                Go to latest
              </Link>
            </div>
          )}

          <DocumentBody
            doc={{
              id: doc.id,
              title: doc.title,
              content: doc.content,
              visibility: doc.visibility,
              currentVersion: doc.currentVersion,
            }}
            canEdit={isLatest}
            rendered={
              <DocContent
                // The canvas below shows the diagram; don't repeat its source here.
                content={isErd ? stripErdBlock(doc.content) : doc.content}
              />
            }
          />

          {figma && (
            <section className="flex flex-col gap-2">
              <h2 className="text-base font-semibold">Design</h2>
              <iframe
                title="Figma design"
                src={figma}
                className="aspect-video w-full rounded-xl border"
                allowFullScreen
              />
            </section>
          )}
        </div>

        {isErd && (
          <div className="min-w-0 lg:col-span-2">
            <ErdCanvas
              key={doc.version}
              doc={{
                id: doc.id,
                content: doc.content,
                currentVersion: doc.currentVersion,
              }}
              canEdit={isLatest}
            />
          </div>
        )}

        <aside className="flex min-w-0 flex-col gap-6 lg:col-start-2 lg:row-start-1">
          {reqs && (
            <RequirementsPanel
              documentId={doc.id}
              data={reqs}
              canEdit={isLatest && Boolean(shares)}
            />
          )}

          {approval && shares && (
            <SideCard title="Client approval">
              <ClientApprovalPanel
                documentId={doc.id}
                status={approval}
                shares={shares}
              />
            </SideCard>
          )}

          <SideCard title={`Versions (${versions.length})`}>
            <ol className="flex flex-col">
              {versions.map((v) => (
                <li key={v.version}>
                  <Link
                    href={
                      v.version === doc.currentVersion
                        ? `/documents/${doc.id}`
                        : `/documents/${doc.id}?v=${v.version}`
                    }
                    aria-current={
                      v.version === doc.version ? "page" : undefined
                    }
                    className={cn(
                      "-mx-2 flex flex-col rounded-lg px-2 py-2 text-sm transition-colors hover:bg-accent",
                      v.version === doc.version && "bg-accent",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        v{v.version}
                        {v.version === doc.currentVersion && (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                            latest
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDateShort(v.createdAt)}
                      </span>
                    </span>
                    <span className="truncate text-muted-foreground">
                      {v.author}
                      {v.note && ` · ${v.note}`}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
            {versions.length > 1 && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <History className="size-3.5" />
                Every save keeps the previous version.
              </p>
            )}
          </SideCard>
        </aside>
      </div>
    </div>
  );
}

function SideCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border bg-card p-4">
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}
