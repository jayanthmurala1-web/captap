import { LearnedRules } from "@/components/learned-rules";
import { requireProject } from "@/lib/access";
import { listDocuments } from "@/lib/documents";
import { getProject, listProjectMembers } from "@/lib/projects";
import { listRoles } from "@/lib/roles";
import { requireSession } from "@/lib/session";
import { listLearnedRules, listSkills } from "@/lib/skills";
import { listMembers } from "@/lib/tasks";
import { listWebhookSubscriptions } from "@/lib/webhooks";
import { SkillForm } from "../../../skills/skill-form";
import { SkillList } from "../../../skills/skill-list";
import { SetGithubRepoForm } from "../../../tasks/task-forms";
import {
  DeleteProjectDialog,
  RenameProjectForm,
} from "./project-settings-form";
import { TeamSection } from "./team-section";
import { WebhooksSection } from "./webhooks-section";

export default async function ProjectSettingsPage({
  params,
}: PageProps<"/projects/[id]/settings">) {
  const { id } = await params;
  const { user } = await requireSession();
  const project = await getProject(user.id, id);
  const [caller, projectMembers, orgMembers, skills, rules, documents] =
    await Promise.all([
      requireProject(user.id, id),
      listProjectMembers(user.id, id),
      listMembers(user.id, project.orgId),
      listSkills(user.id, { projectId: id }),
      listLearnedRules(user.id, id),
      listDocuments(user.id, id),
    ]);
  const roles = await listRoles(user.id, project.orgId);
  const canManage = caller.caps.has("manage_project_settings");
  // Admin-only (endpoints receive every project event); null hides the section.
  const hooks = await listWebhookSubscriptions(user.id, {
    projectId: id,
  }).catch(() => null);

  const assigned = new Set(projectMembers.map((m) => m.userId));
  const candidates = orgMembers
    .filter((m) => !assigned.has(m.id))
    .map((m) => ({ userId: m.id, name: m.name, email: m.email }));
  const ledgers: Record<string, { id: string }> = {};
  for (const d of documents) {
    if (d.docType === "work_ledger") ledgers[d.createdBy] = { id: d.id };
  }

  return (
    <div className="flex max-w-3xl flex-col gap-10">
      {canManage && (
        <Section
          title="General"
          description="The name and description your team and clients see."
        >
          <RenameProjectForm
            projectId={id}
            name={project.name}
            description={project.description}
          />
        </Section>
      )}

      <Section
        title="GitHub repository"
        description="Submitted commits are checked against this repo: the commit must exist and CI must pass."
      >
        {canManage ? (
          <SetGithubRepoForm projectId={id} currentRepo={project.githubRepo} />
        ) : (
          <p className="font-mono text-sm">
            {project.githubRepo ?? "Not linked"}
          </p>
        )}
      </Section>

      <Section
        title="People"
        description="Who can see and work on this project."
      >
        <TeamSection
          projectId={id}
          members={projectMembers}
          candidates={candidates}
          canManage={canManage}
          roles={roles}
          ledgers={ledgers}
        />
      </Section>

      <Section
        title="Learned rules"
        description="Distilled from work sent back on this project. Skills get them on matching tasks."
      >
        <LearnedRules rules={rules} canManage={canManage} />
      </Section>

      <Section
        title="Skills"
        description="Org skills from Flow, plus any made just for this project."
      >
        <SkillList skills={skills} showScope />
        {canManage && (
          <details className="rounded-2xl border bg-card p-4">
            <summary className="cursor-pointer select-none text-sm font-medium">
              New skill for this project
            </summary>
            <div className="mt-4 border-t pt-4">
              <SkillForm projectId={id} />
            </div>
          </details>
        )}
      </Section>

      {hooks && (
        <Section
          title="Webhooks"
          description="Notify Slack, Discord or your own endpoint when work moves."
        >
          <WebhooksSection projectId={id} hooks={hooks} />
        </Section>
      )}

      {canManage && (
        <Section
          title="Danger zone"
          description="Deleting a project can't be undone."
        >
          <div className="self-start">
            <DeleteProjectDialog projectId={id} name={project.name} />
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}
