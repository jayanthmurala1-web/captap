import { FolderGit2 } from "lucide-react";
import { notFound } from "next/navigation";
import { NotFoundError } from "@/lib/errors";
import { getProject } from "@/lib/projects";
import { requireSession } from "@/lib/session";
import { ProjectTabs } from "./project-tabs";

export default async function ProjectLayout({
  params,
  children,
}: LayoutProps<"/projects/[id]">) {
  const { id } = await params;
  const { user } = await requireSession();
  const project = await getProject(user.id, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="border-b px-4 pt-6 sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {project.name}
            </h1>
            {project.description && (
              <p className="mt-1 line-clamp-1 max-w-2xl text-sm text-muted-foreground">
                {project.description}
              </p>
            )}
          </div>
          {project.githubRepo && (
            <a
              href={`https://github.com/${project.githubRepo}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <FolderGit2 className="size-3.5 shrink-0" />
              <span className="truncate">{project.githubRepo}</span>
            </a>
          )}
        </div>
        <ProjectTabs projectId={project.id} />
      </header>
      <main className="flex min-w-0 flex-1 flex-col gap-6 px-4 py-6 sm:px-8">
        {children}
      </main>
    </div>
  );
}
