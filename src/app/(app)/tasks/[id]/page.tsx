import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CircleX,
  ExternalLink,
  FileCheck2,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import Markdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import { requireProject } from "@/lib/access";
import { getApprovalStatus } from "@/lib/document-share";
import { getDocument } from "@/lib/documents";
import { NotFoundError } from "@/lib/errors";
import { getProject } from "@/lib/projects";
import { listProjectPrds } from "@/lib/requirements";
import {
  type CheckItem,
  type CheckState,
  isBlockingReview,
  reviewChecklist,
} from "@/lib/review-checklist";
import { requireSession } from "@/lib/session";
import { listSkills } from "@/lib/skills";
import { listTaskHandoffs } from "@/lib/swarm";
import { ROLE_LABEL } from "@/lib/task-labels";
import { getTask } from "@/lib/tasks";
import { cn, formatDateShort } from "@/lib/utils";
import {
  DecisionForm,
  RetractSubmissionButton,
  RunPersonaReviewButton,
  VerifySubmissionButton,
} from "../task-forms";
import { AgentPicker } from "./agent-picker";
import { BranchCard } from "./branch-card";
import { DeleteTask } from "./delete-task";
import { TaskLinksEditor } from "./task-links";

type Task = Awaited<ReturnType<typeof getTask>>;
type Submission = Task["submissions"][number];

const STATUS_LABEL: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
};

export default async function TaskPage({ params }: PageProps<"/tasks/[id]">) {
  const { id } = await params;
  const { user } = await requireSession();
  const t = await getTask(user.id, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const prdId = t.prd?.id ?? null;
  const [project, handoffs, prd, approval, skills, caller, prds] =
    await Promise.all([
      getProject(user.id, t.projectId),
      listTaskHandoffs(user.id, t.id).catch(() => []),
      prdId ? getDocument(user.id, prdId).catch(() => null) : null,
      // Admin-only; members just don't see the client's decision.
      prdId ? getApprovalStatus(user.id, prdId).catch(() => null) : null,
      listSkills(user.id, { projectId: t.projectId }),
      requireProject(user.id, t.projectId),
      listProjectPrds(user.id, t.projectId),
    ]);
  const agents = {
    all: skills.map((s) => s.name),
    specialists: skills.filter((s) => s.kind === "guide").map((s) => s.name),
    reviewers: skills.filter((s) => s.kind === "review").map((s) => s.name),
  };
  const canManage = caller.caps.has("manage_tasks");
  const canApprove = caller.caps.has("approve_tasks");

  const latest = t.submissions[0];
  const checklist = latest
    ? reviewChecklist(latest, { prdLinked: Boolean(prd) })
    : null;
  const drift = latest?.reviews.find((r) => r.skill === "requirement-drift");

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="border-b px-4 pt-5 pb-5 sm:px-8">
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-1 text-sm text-muted-foreground"
        >
          <Link
            href={`/projects/${t.projectId}`}
            className="truncate hover:text-foreground"
          >
            {project.name}
          </Link>
          <ChevronRight className="size-3.5 shrink-0" />
          <span className="font-mono text-foreground">{t.key}</span>
        </nav>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {t.title}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={t.status === "done" ? "success" : "secondary"}>
            {STATUS_LABEL[t.status] ?? t.status}
          </Badge>
          <Badge variant="outline">{ROLE_LABEL[t.role] ?? t.role}</Badge>
          {t.claimedAgent && (
            <span className="text-muted-foreground">
              Agent{" "}
              <span className="font-mono text-foreground">
                {t.claimedAgent}
              </span>
            </span>
          )}
        </div>
      </header>

      <div className="grid min-w-0 gap-8 px-4 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          {t.reviewNote && t.status === "in_progress" && (
            <Callout tone="warning" title="Sent back for changes">
              {t.reviewNote}
            </Callout>
          )}

          {checklist && latest && (
            <ReviewCard
              agents={agents}
              t={t}
              latest={latest}
              items={checklist.items}
              verdict={checklist.verdict}
              canApprove={canApprove}
              blockingReviews={latest.reviews
                .filter(isBlockingReview)
                .map((r) => r.skill)}
            />
          )}

          {drift && drift.status !== "PASS" && prd && (
            <DriftCard drift={drift} prdId={prd.id} prdTitle={prd.title} />
          )}

          {!latest && t.status !== "done" && (
            <DecisionForm
              agents={agents.all}
              taskId={t.id}
              projectId={t.projectId}
              status={t.status}
              canApprove={canApprove}
            />
          )}

          <Section title="Description">
            {t.description ? (
              <div className="prose-doc">
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeSanitize]}
                >
                  {t.description}
                </Markdown>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No description yet.
              </p>
            )}
          </Section>

          {t.submissions.length > 0 && (
            <Section title={`Submissions (${t.submissions.length})`}>
              <ol className="flex flex-col gap-4">
                {t.submissions.map((s, i) => (
                  <SubmissionCard
                    key={s.id}
                    s={s}
                    taskId={t.id}
                    projectId={t.projectId}
                    canRetract={
                      t.status === "in_review" &&
                      s.decision === "pending" &&
                      s.submittedBy === user.id
                    }
                    latest={i === 0}
                  />
                ))}
              </ol>
            </Section>
          )}

          {handoffs.length > 0 && (
            <Section title="Handoffs">
              <ol className="flex flex-col gap-2 text-sm">
                {handoffs.map((h) => (
                  <li key={h.id} className="text-muted-foreground">
                    <span className="font-mono text-foreground">
                      {h.fromAgent}
                    </span>{" "}
                    ({h.fromRole}) → {h.toRole}
                    {h.note && <>: {h.note}</>}
                    <span className="ml-2 text-xs">
                      {formatDateShort(h.createdAt)}
                    </span>
                  </li>
                ))}
              </ol>
            </Section>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-6">
          <RequirementsSource
            prd={prd}
            approval={approval}
            projectId={t.projectId}
          />

          <SideCard title="Delivers">
            {t.requirements.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t.prd
                  ? "Not tied to a specific requirement of the PRD."
                  : "Not tied to a requirement."}
              </p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {t.requirements.map((r) => (
                  <li key={r.id}>
                    <span className="font-mono text-xs text-muted-foreground">
                      {r.key}
                    </span>{" "}
                    {r.text}
                    {r.removed && (
                      <Badge variant="warning" className="ml-1.5">
                        removed from PRD
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {t.legacyGroup && (
              <p className="mt-2 text-xs text-muted-foreground">
                Earlier group: {t.legacyGroup}
              </p>
            )}
            {canManage && (
              <TaskLinksEditor
                key={`${t.prd?.id}-${t.requirements.map((r) => r.key).join()}`}
                taskId={t.id}
                prds={prds}
                prdId={t.prd?.id ?? null}
                keys={t.requirements
                  .filter((r) => !r.removed)
                  .map((r) => r.key)}
              />
            )}
          </SideCard>

          <SideCard title="Details">
            <dl className="flex flex-col gap-2.5 text-sm">
              <Prop label="Assignee">{t.assignee?.name ?? "Unassigned"}</Prop>
              {!canManage && (
                <Prop label="Agent">{t.assignedSkill ?? "Auto-match"}</Prop>
              )}
              <Prop label="Points">{t.storyPoints ?? 1}</Prop>
            </dl>
            {canManage && t.status !== "done" && (
              <div className="mt-4 border-t pt-3">
                <p className="mb-2 text-xs text-muted-foreground">Agent</p>
                <AgentPicker
                  taskId={t.id}
                  current={t.assignedSkill}
                  agents={agents.specialists}
                />
              </div>
            )}
            {canManage && (
              <div className="mt-4 border-t pt-3">
                <DeleteTask
                  taskId={t.id}
                  projectId={t.projectId}
                  title={t.title}
                  busy={t.status === "in_progress" || t.status === "in_review"}
                />
              </div>
            )}
            {t.dependencies.length > 0 && (
              <div className="mt-4 border-t pt-3">
                <p className="mb-2 text-xs text-muted-foreground">
                  Depends on {t.blocked && t.status === "todo" && "· blocked"}
                </p>
                <ul className="flex flex-col gap-1.5 text-sm">
                  {t.dependencies.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between gap-2"
                    >
                      <Link
                        href={`/tasks/${d.id}`}
                        className="min-w-0 truncate hover:underline"
                      >
                        <span className="font-mono text-muted-foreground">
                          {d.key}
                        </span>{" "}
                        {d.title}
                      </Link>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {STATUS_LABEL[d.status] ?? d.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </SideCard>

          {(t.learnedRules.length > 0 ||
            t.matchedSkills.length > 0 ||
            t.suggestedDocs.length > 0) && (
            <SideCard title="Context given to the agent">
              <div className="flex flex-col gap-3 text-sm">
                {t.learnedRules.length > 0 && (
                  <ul className="flex flex-col gap-1.5">
                    {t.learnedRules.map((r) => (
                      <li key={r.id} className="flex gap-2">
                        <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
                        <span>{r.rule}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {t.matchedSkills.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {t.matchedSkills.map((s) => (
                      <Badge key={s.name} variant="secondary" title={s.reason}>
                        {s.name}
                      </Badge>
                    ))}
                  </div>
                )}
                {t.suggestedDocs.map((d) => (
                  <Link
                    key={d.id}
                    href={`/documents/${d.id}`}
                    className="text-primary hover:underline"
                  >
                    {d.title}
                  </Link>
                ))}
              </div>
            </SideCard>
          )}

          {t.status !== "done" && (
            <SideCard title="Branch">
              <BranchCard taskId={t.id} isolation={t.gitIsolation} />
            </SideCard>
          )}
        </aside>
      </div>
    </div>
  );
}

const STATE_ICON: Record<
  CheckState,
  { icon: typeof CircleCheck; className: string; label: string }
> = {
  pass: { icon: CircleCheck, className: "text-success", label: "Passed" },
  fail: { icon: CircleX, className: "text-destructive", label: "Failed" },
  warn: { icon: CircleAlert, className: "text-warning", label: "Needs work" },
  pending: {
    icon: CircleDashed,
    className: "text-muted-foreground",
    label: "Pending",
  },
  na: {
    icon: CircleMinus,
    className: "text-muted-foreground/60",
    label: "Not applicable",
  },
};

const VERDICT = {
  ready: { title: "All checks passed", tone: "text-success" },
  issues: { title: "Issues to look at before approving", tone: "text-warning" },
  incomplete: {
    title: "Some checks haven't run yet",
    tone: "text-muted-foreground",
  },
} as const;

function ReviewCard({
  agents,
  t,
  latest,
  items,
  verdict,
  canApprove,
  blockingReviews,
}: {
  canApprove: boolean;
  agents: { all: string[]; reviewers: string[] };
  t: Task;
  latest: Submission;
  items: CheckItem[];
  verdict: keyof typeof VERDICT;
  /** Review skill names that are blocking approval (spec 024). */
  blockingReviews: string[];
}) {
  const decided = latest.decision !== "pending";
  return (
    <section className="rounded-2xl border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">
            Latest submission ·{" "}
            <span className="font-mono">{latest.agent}</span> ·{" "}
            {formatDateShort(latest.createdAt)}
          </p>
          <h2
            className={cn("mt-1 text-lg font-semibold", VERDICT[verdict].tone)}
          >
            {decided
              ? latest.decision === "approved"
                ? "Approved"
                : "Sent back"
              : VERDICT[verdict].title}
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <VerifySubmissionButton submissionId={latest.id} taskId={t.id} />
          <RunPersonaReviewButton
            submissionId={latest.id}
            taskId={t.id}
            reviewers={agents.reviewers}
          />
        </div>
      </div>

      <ul className="mt-4 divide-y rounded-xl border">
        {items.map((item) => {
          const s = STATE_ICON[item.state];
          return (
            <li key={item.id} className="flex items-start gap-3 px-4 py-3">
              <s.icon
                className={cn("mt-0.5 size-4 shrink-0", s.className)}
                aria-label={s.label}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-sm text-muted-foreground">{item.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>

      {(t.status === "in_review" || t.status === "in_progress") && (
        <div className="mt-5 border-t pt-5">
          <DecisionForm
            agents={agents.all}
            taskId={t.id}
            projectId={t.projectId}
            status={t.status}
            canApprove={canApprove}
            blockingReviews={blockingReviews}
          />
        </div>
      )}
    </section>
  );
}

function DriftCard({
  drift,
  prdId,
  prdTitle,
}: {
  drift: Submission["reviews"][number];
  prdId: string;
  prdTitle: string;
}) {
  const unmet = drift.criteriaChecks?.filter((c) => !c.passed) ?? [];
  return (
    <section className="rounded-2xl border border-warning/40 bg-warning/5 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <CircleAlert className="mt-0.5 size-5 shrink-0 text-warning" />
        <div className="min-w-0">
          <h2 className="font-semibold">
            This work doesn&apos;t match{" "}
            <Link
              href={`/documents/${prdId}`}
              className="underline underline-offset-4"
            >
              {prdTitle}
            </Link>
          </h2>
          <p className="mt-1 text-sm text-foreground/85">{drift.summary}</p>
        </div>
      </div>
      {unmet.length > 0 && (
        <ul className="mt-4 flex flex-col gap-3 pl-8">
          {unmet.map((c) => (
            <li key={c.criterion} className="text-sm">
              <p className="font-medium">{c.criterion}</p>
              {c.evidence && (
                <p className="text-muted-foreground">{c.evidence}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SubmissionCard({
  s,
  taskId,
  projectId,
  canRetract,
  latest,
}: {
  s: Submission;
  taskId: string;
  projectId: string;
  canRetract: boolean;
  latest: boolean;
}) {
  const v = s.verificationDetails;
  return (
    <li className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p>
          <span className="font-mono">{s.agent}</span>
          <span className="text-muted-foreground">
            {" "}
            · {formatDateShort(s.createdAt)}
          </span>
        </p>
        <div className="flex items-center gap-2">
          {s.verificationStatus === "verified" ? (
            <Badge variant="success">GitHub verified</Badge>
          ) : s.verificationStatus === "failed" ? (
            <Badge variant="destructive">Verification failed</Badge>
          ) : (
            <Badge variant="secondary">Agent-reported</Badge>
          )}
          {canRetract && (
            <RetractSubmissionButton taskId={taskId} projectId={projectId} />
          )}
          {s.decision !== "pending" && (
            <Badge
              variant={s.decision === "approved" ? "success" : "warning"}
              className="capitalize"
            >
              {s.decision === "approved" ? "Approved" : "Sent back"}
            </Badge>
          )}
        </div>
      </div>
      <p className="mt-2 text-sm">{s.summary}</p>

      <dl className="mt-3 grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
        {s.commitSha && (
          <>
            <dt className="text-muted-foreground">Commit</dt>
            <dd className="min-w-0 truncate font-mono">
              {v?.commitUrl ? (
                <a
                  href={v.commitUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  {s.commitSha.slice(0, 7)}
                </a>
              ) : (
                s.commitSha.slice(0, 7)
              )}
              {v?.commitAuthor && (
                <span className="font-sans text-muted-foreground">
                  {" "}
                  by {v.commitAuthor}
                </span>
              )}
            </dd>
          </>
        )}
        {v?.prUrl && (
          <>
            <dt className="text-muted-foreground">Pull request</dt>
            <dd>
              <a
                href={v.prUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                #{v.prNumber} ({v.prState}) <ExternalLink className="size-3" />
              </a>
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">Files</dt>
        <dd className="min-w-0 break-words font-mono text-xs leading-6">
          {s.filesChanged.join(", ")}
        </dd>
        <dt className="text-muted-foreground">Tests</dt>
        <dd className="flex min-w-0 flex-col gap-0.5">
          {s.tests.map((x) => (
            <span
              key={x.command}
              className={cn(
                "font-mono text-xs leading-6",
                x.exitCode === 0 ? "text-success" : "text-destructive",
              )}
            >
              {x.command} → {x.exitCode === 0 ? "passed" : `exit ${x.exitCode}`}
              {x.summary && (
                <span className="font-sans text-muted-foreground">
                  {" "}
                  · {x.summary}
                </span>
              )}
            </span>
          ))}
        </dd>
      </dl>

      {s.reviews.length > 0 && (
        <details className="mt-3 border-t pt-3" open={latest}>
          <summary className="cursor-pointer text-sm font-medium">
            Reviews ({s.reviews.length})
          </summary>
          <ul className="mt-3 flex flex-col gap-3">
            {s.reviews.map((r) => (
              <li key={r.skill} className="text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{r.skill}</span>
                  <Badge
                    variant={
                      r.status === "PASS"
                        ? "success"
                        : r.status === "FAIL"
                          ? "destructive"
                          : "warning"
                    }
                  >
                    {r.status === "NEEDS_WORK"
                      ? "Needs work"
                      : r.status === "PASS"
                        ? "Pass"
                        : "Fail"}
                  </Badge>
                </div>
                <p className="mt-1 text-muted-foreground">{r.summary}</p>
                {r.findings && r.findings.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {r.findings.map((f) => (
                      <li
                        key={`${f.severity}-${f.problem}`}
                        className="rounded-lg bg-muted/60 px-3 py-2"
                      >
                        <span className="text-xs font-semibold">
                          {f.severity}
                        </span>{" "}
                        {f.fileLine && (
                          <code className="font-mono text-xs">
                            {f.fileLine}
                          </code>
                        )}
                        <p>{f.problem}</p>
                        {f.fix && (
                          <p className="text-muted-foreground">Fix: {f.fix}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {latest && !s.reviews.length && (
        <p className="mt-3 text-sm text-muted-foreground">
          No reviews run yet.
        </p>
      )}
      {!latest && (
        <div className="mt-3 flex gap-2">
          <VerifySubmissionButton submissionId={s.id} taskId={taskId} />
        </div>
      )}
    </li>
  );
}

function RequirementsSource({
  prd,
  approval,
  projectId,
}: {
  prd: Awaited<ReturnType<typeof getDocument>> | null;
  approval: Awaited<ReturnType<typeof getApprovalStatus>> | null;
  projectId: string;
}) {
  if (!prd) {
    return (
      <SideCard title="Checked against">
        <p className="text-sm text-muted-foreground">
          This task isn&apos;t built under a PRD, so the drift check can&apos;t
          run.
        </p>
        <Link
          href={`/projects/${projectId}/documents`}
          className="mt-2 inline-block text-sm text-primary hover:underline"
        >
          Project documents
        </Link>
      </SideCard>
    );
  }
  const latest = approval?.latest;
  return (
    <SideCard title="Checked against">
      <Link
        href={`/documents/${prd.id}`}
        className="flex items-center gap-2 font-medium hover:underline"
      >
        <FileCheck2 className="size-4 shrink-0 text-primary" />
        <span className="truncate">{prd.title}</span>
      </Link>
      <p className="mt-1 text-sm text-muted-foreground">
        Current version v{prd.currentVersion}
      </p>
      <div className="mt-3 border-t pt-3 text-sm">
        {!approval ? (
          <p className="text-muted-foreground">
            Client approval is visible to project leads.
          </p>
        ) : !latest ? (
          <p className="text-muted-foreground">
            Not approved by the client yet.
          </p>
        ) : latest.decision === "changes_requested" ? (
          <p className="text-warning">
            Client requested changes on v{latest.version}.
          </p>
        ) : approval.stale ? (
          <p className="text-warning">
            Client approved v{latest.version}; the PRD has changed since.
          </p>
        ) : (
          <p className="text-success">
            Client approved this version ({latest.approverName}).
          </p>
        )}
      </div>
    </SideCard>
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

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Prop({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
    </div>
  );
}

function Callout({
  tone,
  title,
  children,
}: {
  tone: "warning";
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3 text-sm",
        tone === "warning" && "border-warning/40 bg-warning/5",
      )}
    >
      <p className="font-medium text-warning">{title}</p>
      <p className="mt-1">{children}</p>
    </div>
  );
}
