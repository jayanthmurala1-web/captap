import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  capabilitiesOf,
  ForbiddenError,
  NotFoundError,
  requireMember,
} from "@/lib/access";
import { requireSession } from "@/lib/session";
import { splitSkill } from "@/lib/skill-parser";
import { getSkillById } from "@/lib/skills";
import { formatDateShort } from "@/lib/utils";
import { deleteSkillAction } from "../actions";
import { PublishForm } from "../publish-form";
import { SkillForm } from "../skill-form";

export default async function SkillPage({ params }: PageProps<"/skills/[id]">) {
  const { id } = await params;
  const { user } = await requireSession();
  const skill = await getSkillById(user.id, id).catch((e) => {
    if (e instanceof NotFoundError || e instanceof ForbiddenError) notFound();
    throw e;
  });
  const role = await requireMember(user.id, skill.orgId);
  const isOrgAdmin = (await capabilitiesOf(skill.orgId, role)).has(
    "manage_org_settings",
  );
  const canEdit = skill.projectId !== null || isOrgAdmin;
  const canPublish = skill.projectId === null && isOrgAdmin;
  const back = skill.projectId
    ? {
        href: `/projects/${skill.projectId}/settings`,
        label: "Project settings",
      }
    : { href: "/flow", label: "Org Flow" };

  return (
    <main className="flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-8">
      <div>
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-1 text-sm text-muted-foreground"
        >
          <Link href={back.href} className="hover:text-foreground">
            {back.label}
          </Link>
          <ChevronRight className="size-3.5" />
          <span className="font-mono text-foreground">{skill.name}</span>
        </nav>
        <h1 className="mt-2 font-mono text-2xl font-semibold">{skill.name}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary">
            {skill.kind === "review" ? "Reviewer" : "Specialist"}
          </Badge>
          <Badge variant="outline">
            {skill.projectId ? "This project only" : "Workspace-wide"}
          </Badge>
          updated {formatDateShort(skill.updatedAt)}
        </p>
      </div>

      {canEdit ? (
        <>
          <SkillForm
            skill={{
              id: skill.id,
              kind: skill.kind,
              ...splitSkill(skill.source),
            }}
            projectId={skill.projectId ?? undefined}
          />
          {canPublish && (
            <details className="rounded-2xl border bg-card p-4">
              <summary className="cursor-pointer select-none text-sm font-medium">
                Publish to marketplace
              </summary>
              <div className="mt-4 border-t pt-4">
                <PublishForm skillId={skill.id} />
              </div>
            </details>
          )}
          <form action={deleteSkillAction} className="border-t pt-4">
            <input type="hidden" name="id" value={skill.id} />
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
            >
              Delete skill
            </Button>
          </form>
        </>
      ) : (
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-2xl border bg-card p-4 font-mono text-sm">
          {skill.source}
        </pre>
      )}
    </main>
  );
}
