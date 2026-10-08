import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  document,
  documentVersion,
  task,
  taskSubmission,
  user,
} from "@/db/schema";
import { requireProject } from "./access";
import { listTasks, taskKey } from "./tasks";

const STALE_MS = 24 * 60 * 60 * 1000;

/** "Where are we?": deterministic project state for humans and resuming agents. No AI, no guessed scores. */
export async function getProjectStatus(
  userId: string,
  projectId: string,
  now = new Date(),
) {
  const p = await requireProject(userId, projectId);
  const [tasks, claims, docChanges, decisions] = await Promise.all([
    listTasks(userId, p.projectId),
    db
      .select({
        id: task.id,
        claimedAt: task.claimedAt,
        reviewNote: task.reviewNote,
      })
      .from(task)
      .where(
        and(eq(task.projectId, p.projectId), eq(task.status, "in_progress")),
      ),
    db
      .select({
        documentId: document.id,
        title: document.title,
        version: documentVersion.version,
        note: documentVersion.note,
        author: user.name,
        at: documentVersion.createdAt,
      })
      .from(documentVersion)
      .innerJoin(document, eq(document.id, documentVersion.documentId))
      .innerJoin(user, eq(user.id, documentVersion.authorId))
      .where(eq(document.projectId, projectId))
      .orderBy(desc(documentVersion.createdAt))
      .limit(5),
    db
      .select({
        taskId: task.id,
        number: task.number,
        title: task.title,
        decision: taskSubmission.decision,
        note: taskSubmission.decisionNote,
        at: taskSubmission.decidedAt,
      })
      .from(taskSubmission)
      .innerJoin(task, eq(task.id, taskSubmission.taskId))
      .where(and(eq(task.projectId, projectId)))
      .orderBy(desc(taskSubmission.decidedAt))
      .limit(10),
  ]);

  const claimById = new Map(claims.map((c) => [c.id, c]));
  const brief = (t: (typeof tasks)[number]) => ({
    id: t.id,
    key: t.key,
    title: t.title,
    role: t.role,
  });
  const count = (s: string) => tasks.filter((t) => t.status === s).length;
  const done = count("done");
  const inProgress = tasks.filter((t) => t.status === "in_progress");

  return {
    progress: {
      total: tasks.length,
      todo: count("todo"),
      inProgress: inProgress.length,
      inReview: count("in_review"),
      done,
      percentDone: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    },
    needsReview: tasks
      .filter((t) => t.status === "in_review")
      .map((t) => ({ ...brief(t), agent: t.claimedAgent })),
    blocked: tasks
      .filter((t) => t.status === "todo" && t.blockedBy.length)
      .map((t) => ({ ...brief(t), blockedBy: t.blockedBy })),
    stale: inProgress
      .filter((t) => {
        const at = claimById.get(t.id)?.claimedAt;
        return at && now.getTime() - at.getTime() > STALE_MS;
      })
      .map((t) => ({
        ...brief(t),
        agent: t.claimedAgent,
        claimedAt: claimById.get(t.id)?.claimedAt,
      })),
    sentBack: inProgress
      .filter((t) => claimById.get(t.id)?.reviewNote)
      .map((t) => ({
        ...brief(t),
        agent: t.claimedAgent,
        note: claimById.get(t.id)?.reviewNote,
      })),
    nextUp: tasks
      .filter((t) => t.status === "todo" && !t.blockedBy.length)
      .slice(0, 5)
      .map((t) => ({ ...brief(t), assignee: t.assignee })),
    recentDocumentChanges: docChanges,
    recentDecisions: decisions
      .filter((d) => d.at)
      .map(({ number, ...d }) => ({ ...d, key: taskKey(number) })),
    lastActivityAt:
      [...tasks.map((t) => t.updatedAt), ...docChanges.map((d) => d.at)].sort(
        (a, b) => b.getTime() - a.getTime(),
      )[0] ?? null,
  };
}
