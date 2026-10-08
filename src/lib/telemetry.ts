import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  document,
  project,
  task,
  taskDependency,
  taskSubmission,
} from "@/db/schema";
import { requireProject } from "./access";
import { taskKey } from "./tasks";

export interface ArchitectureReadiness {
  score: number; // 0 to 100
  gateStatus: "ready" | "partial" | "blocked";
  gateLabel: string;
  gateDescription: string;
  breakdown: {
    docType: "brief" | "prd" | "hld" | "lld" | "erd";
    label: string;
    weight: number;
    status: "published" | "draft" | "missing";
    earnedScore: number;
    documentId?: string;
    title?: string;
  }[];
}

export interface AgentAutonomyMetrics {
  autonomyIndex: number; // 0 to 100%
  totalDecidedTasks: number;
  firstPassApprovedTasks: number;
  reworkSubmissionsCount: number;
  totalSubmissionsCount: number;
  averageCyclesPerTask: number;
  agentPerformance: {
    agent: string;
    submissionsCount: number;
    approvedCount: number;
    rejectedCount: number;
    firstPassRate: number;
  }[];
}

export interface DependencyBottleneck {
  taskId: string;
  key: string;
  title: string;
  status: string;
  role: string;
  assignee?: string | null;
  claimedAgent?: string | null;
  directDependentsCount: number;
  totalTransitiveBlockedCount: number;
  bottleneckScore: number;
}

export interface DependencyGraphSummary {
  criticalPathDepth: number;
  totalDependenciesCount: number;
  bottlenecks: DependencyBottleneck[];
}

export interface ArchitecturalDriftAlert {
  severity: "high" | "medium" | "low" | "info";
  category: "database_schema" | "api_surface" | "review_drift";
  title: string;
  description: string;
  remediation: string;
  taskId?: string;
  taskKey?: string;
  offendingFiles: string[];
}

export interface ArchitecturalDriftSummary {
  driftScore: number; // 0 (pristine) to 100 (severe drift)
  hasDrift: boolean;
  alerts: ArchitecturalDriftAlert[];
}

export interface ProjectTelemetry {
  projectId: string;
  projectName: string;
  generatedAt: string;
  readiness: ArchitectureReadiness;
  autonomy: AgentAutonomyMetrics;
  dependencies: DependencyGraphSummary;
  drift: ArchitecturalDriftSummary;
}

const ARCH_DOC_WEIGHTS: Record<
  "brief" | "prd" | "hld" | "lld" | "erd",
  { weight: number; label: string }
> = {
  brief: { weight: 15, label: "Project Brief" },
  prd: { weight: 35, label: "PRD (Product Requirements Document)" },
  hld: { weight: 20, label: "HLD (High-Level Design)" },
  lld: { weight: 15, label: "LLD (Low-Level Design)" },
  erd: { weight: 15, label: "Database ERD (Entity Relationship Diagram)" },
};

export async function getProjectTelemetry(
  userId: string,
  projectId: string,
): Promise<ProjectTelemetry> {
  const { projectId: projId } = await requireProject(userId, projectId);

  const [proj] = await db
    .select({ id: project.id, name: project.name })
    .from(project)
    .where(eq(project.id, projId));
  if (!proj) {
    throw new Error("Project not found");
  }

  // 1. Fetch Architecture Readiness
  const docs = await db
    .select({
      id: document.id,
      title: document.title,
      docType: document.docType,
      visibility: document.visibility,
      updatedAt: document.updatedAt,
    })
    .from(document)
    .where(eq(document.projectId, proj.id));

  const docByType = new Map<string, (typeof docs)[number]>();
  for (const d of docs) {
    if (d.docType) {
      const existing = docByType.get(d.docType);
      // Prefer published over draft
      if (
        !existing ||
        (existing.visibility === "draft" && d.visibility === "published")
      ) {
        docByType.set(d.docType, d);
      }
    }
  }

  let totalScore = 0;
  const breakdown: ArchitectureReadiness["breakdown"] = [];

  for (const [type, meta] of Object.entries(ARCH_DOC_WEIGHTS) as [
    "brief" | "prd" | "hld" | "lld" | "erd",
    { weight: number; label: string },
  ][]) {
    const doc = docByType.get(type);
    let status: "published" | "draft" | "missing" = "missing";
    let earned = 0;

    if (doc) {
      if (doc.visibility === "published") {
        status = "published";
        earned = meta.weight;
      } else {
        status = "draft";
        earned = Math.round(meta.weight * 0.5);
      }
    }

    totalScore += earned;
    breakdown.push({
      docType: type,
      label: meta.label,
      weight: meta.weight,
      status,
      earnedScore: earned,
      documentId: doc?.id,
      title: doc?.title,
    });
  }

  let gateStatus: ArchitectureReadiness["gateStatus"] = "blocked";
  let gateLabel = "Architecture Incomplete";
  let gateDescription =
    "Core architecture documents are missing or in draft. Autonomous agent executions may drift or hallucinate.";

  if (totalScore >= 80) {
    gateStatus = "ready";
    gateLabel = "Autonomous Execution Ready";
    gateDescription =
      "PRD, HLD, LLD, and Database ERD are approved and published. Specialist agents operate with full context.";
  } else if (totalScore >= 50) {
    gateStatus = "partial";
    gateLabel = "Supervised Execution Mode";
    gateDescription =
      "Foundational PRD is defined, but technical designs (HLD/LLD/ERD) are partially incomplete. Human oversight required.";
  }

  const readiness: ArchitectureReadiness = {
    score: totalScore,
    gateStatus,
    gateLabel,
    gateDescription,
    breakdown,
  };

  // 2. Fetch Tasks and Submissions for Agent Autonomy & Drift
  const allTasks = await db
    .select({
      id: task.id,
      number: task.number,
      title: task.title,
      status: task.status,
      role: task.role,
      assigneeId: task.assigneeId,
      claimedAgent: task.claimedAgent,
    })
    .from(task)
    .where(eq(task.projectId, proj.id))
    .orderBy(task.number);

  const taskIds = allTasks.map((t) => t.id);

  let submissions: Array<typeof taskSubmission.$inferSelect> = [];
  if (taskIds.length > 0) {
    submissions = await db
      .select()
      .from(taskSubmission)
      .where(inArray(taskSubmission.taskId, taskIds))
      .orderBy(taskSubmission.createdAt);
  }

  // Calculate Autonomy Metrics
  const submissionsByTaskId = new Map<
    string,
    Array<typeof taskSubmission.$inferSelect>
  >();
  for (const s of submissions) {
    const list = submissionsByTaskId.get(s.taskId) || [];
    list.push(s);
    submissionsByTaskId.set(s.taskId, list);
  }

  let decidedTasksCount = 0;
  let firstPassApprovedCount = 0;
  let reworkCount = 0;

  const agentStats = new Map<
    string,
    {
      submissions: number;
      approved: number;
      rejected: number;
      firstPassSuccesses: number;
    }
  >();

  for (const t of allTasks) {
    const subs = submissionsByTaskId.get(t.id) || [];
    if (subs.length === 0) {
      if (t.status === "done") {
        decidedTasksCount++;
        firstPassApprovedCount++;
      }
      continue;
    }

    decidedTasksCount++;
    const hadRejection = subs.some((s) => s.decision === "rejected");
    const wasApproved =
      subs.some((s) => s.decision === "approved") || t.status === "done";

    if (wasApproved && !hadRejection) {
      firstPassApprovedCount++;
    }

    for (const sub of subs) {
      if (sub.decision === "rejected") {
        reworkCount++;
      }
      const existing = agentStats.get(sub.agent) || {
        submissions: 0,
        approved: 0,
        rejected: 0,
        firstPassSuccesses: 0,
      };
      existing.submissions++;
      if (sub.decision === "approved") existing.approved++;
      if (sub.decision === "rejected") existing.rejected++;
      agentStats.set(sub.agent, existing);
    }

    const firstSub = subs[0];
    if (firstSub && !hadRejection && wasApproved) {
      const existing = agentStats.get(firstSub.agent);
      if (existing) {
        existing.firstPassSuccesses++;
      }
    }
  }

  const autonomyIndex =
    decidedTasksCount > 0
      ? Math.round((firstPassApprovedCount / decidedTasksCount) * 100)
      : 100;

  const agentPerformance = Array.from(agentStats.entries()).map(
    ([agentName, stats]) => ({
      agent: agentName,
      submissionsCount: stats.submissions,
      approvedCount: stats.approved,
      rejectedCount: stats.rejected,
      firstPassRate:
        stats.submissions > 0
          ? Math.round(
              (stats.firstPassSuccesses /
                Math.max(1, stats.approved + stats.rejected)) *
                100,
            )
          : 100,
    }),
  );

  const autonomy: AgentAutonomyMetrics = {
    autonomyIndex,
    totalDecidedTasks: decidedTasksCount,
    firstPassApprovedTasks: firstPassApprovedCount,
    reworkSubmissionsCount: reworkCount,
    totalSubmissionsCount: submissions.length,
    averageCyclesPerTask:
      decidedTasksCount > 0
        ? Number(
            (submissions.length / Math.max(1, decidedTasksCount)).toFixed(2),
          )
        : 1.0,
    agentPerformance,
  };

  // 3. Dependency DAG & Bottleneck Heatmap
  let deps: Array<{ taskId: string; dependsOnId: string }> = [];
  if (taskIds.length > 0) {
    deps = await db
      .select({
        taskId: taskDependency.taskId,
        dependsOnId: taskDependency.dependsOnId,
      })
      .from(taskDependency)
      .where(
        and(
          inArray(taskDependency.taskId, taskIds),
          inArray(taskDependency.dependsOnId, taskIds),
        ),
      );
  }

  // Graph adjacency: dependsOnId -> list of taskIds that depend on it (downstream dependents)
  const downstreamMap = new Map<string, string[]>();
  // Predecessors map: taskId -> list of dependsOnId (upstream prerequisites)
  const upstreamMap = new Map<string, string[]>();

  for (const d of deps) {
    const list = downstreamMap.get(d.dependsOnId) || [];
    list.push(d.taskId);
    downstreamMap.set(d.dependsOnId, list);

    const upList = upstreamMap.get(d.taskId) || [];
    upList.push(d.dependsOnId);
    upstreamMap.set(d.taskId, upList);
  }

  // Calculate transitive downstream blocked tasks for each task not done
  const taskMap = new Map(allTasks.map((t) => [t.id, t]));
  const bottlenecks: DependencyBottleneck[] = [];

  for (const t of allTasks) {
    if (t.status === "done") continue;

    const direct = downstreamMap.get(t.id) || [];
    if (direct.length === 0) continue;

    // Transitive closure (BFS)
    const visited = new Set<string>();
    const queue = [...direct];
    while (queue.length > 0) {
      const nextId = queue.shift();
      if (!nextId) break;
      if (!visited.has(nextId)) {
        visited.add(nextId);
        const children = downstreamMap.get(nextId) || [];
        for (const child of children) {
          if (!visited.has(child)) queue.push(child);
        }
      }
    }

    const transitiveCount = visited.size;
    const bottleneckScore =
      direct.length * 2 + (transitiveCount - direct.length);

    bottlenecks.push({
      taskId: t.id,
      key: taskKey(t.number),
      title: t.title,
      status: t.status,
      role: t.role,
      assignee: t.assigneeId,
      claimedAgent: t.claimedAgent,
      directDependentsCount: direct.length,
      totalTransitiveBlockedCount: transitiveCount,
      bottleneckScore,
    });
  }

  bottlenecks.sort((a, b) => b.bottleneckScore - a.bottleneckScore);

  // Compute Critical Path Depth (longest path in DAG)
  const depthMemo = new Map<string, number>();
  const getDepth = (id: string, visited: Set<string>): number => {
    const cached = depthMemo.get(id);
    if (cached !== undefined) return cached;
    if (visited.has(id)) return 0; // Prevent cycle if any
    visited.add(id);

    const children = downstreamMap.get(id) || [];
    let maxChildDepth = 0;
    for (const child of children) {
      maxChildDepth = Math.max(
        maxChildDepth,
        1 + getDepth(child, new Set(visited)),
      );
    }
    depthMemo.set(id, maxChildDepth);
    return maxChildDepth;
  };

  let criticalPathDepth = 0;
  for (const t of allTasks) {
    // Only start from roots (tasks without prerequisites)
    const up = upstreamMap.get(t.id) || [];
    if (up.length === 0) {
      criticalPathDepth = Math.max(
        criticalPathDepth,
        1 + getDepth(t.id, new Set()),
      );
    }
  }

  const dependencies: DependencyGraphSummary = {
    criticalPathDepth,
    totalDependenciesCount: deps.length,
    bottlenecks: bottlenecks.slice(0, 5), // Top 5 bottlenecks
  };

  // 4. Architectural Drift Detection
  const hasPublishedErd = docByType.get("erd")?.visibility === "published";
  const hasPublishedLld = docByType.get("lld")?.visibility === "published";

  const alerts: ArchitecturalDriftAlert[] = [];
  let rawDriftPoints = 0;

  for (const s of submissions) {
    const files = s.filesChanged || [];
    const t = taskMap.get(s.taskId);
    const key = t ? taskKey(t.number) : undefined;

    // Database schema drift
    const dbFiles = files.filter(
      (f) =>
        f.toLowerCase().includes("schema") ||
        f.toLowerCase().includes("migration") ||
        f.toLowerCase().includes("drizzle"),
    );

    if (dbFiles.length > 0 && !hasPublishedErd) {
      alerts.push({
        severity: "high",
        category: "database_schema",
        title: "Unapproved Database Schema Alteration",
        description: `Task ${key || s.taskId} modified database schemas or migrations (${dbFiles.join(", ")}) without an approved Database ERD.`,
        remediation:
          "Author and publish the Database ERD in Visual ERD Studio before altering schema tables.",
        taskId: s.taskId,
        taskKey: key,
        offendingFiles: dbFiles,
      });
      rawDriftPoints += 35;
    }

    // API surface drift
    const apiFiles = files.filter(
      (f) =>
        f.toLowerCase().includes("src/app/api") ||
        f.toLowerCase().includes("api/") ||
        f.toLowerCase().includes("route.ts"),
    );

    if (apiFiles.length > 0 && !hasPublishedLld) {
      alerts.push({
        severity: "medium",
        category: "api_surface",
        title: "Unapproved API Surface Expansion",
        description: `Task ${key || s.taskId} added or modified API route handlers (${apiFiles.join(", ")}) without an approved LLD document.`,
        remediation:
          "Define API contract specifications and payload schemas in an LLD architecture document.",
        taskId: s.taskId,
        taskKey: key,
        offendingFiles: apiFiles,
      });
      rawDriftPoints += 20;
    }
  }

  const driftScore = Math.min(100, rawDriftPoints);
  const drift: ArchitecturalDriftSummary = {
    driftScore,
    hasDrift: alerts.length > 0,
    alerts: alerts.slice(0, 10), // Limit top 10 alerts
  };

  return {
    projectId: proj.id,
    projectName: proj.name,
    generatedAt: new Date().toISOString(),
    readiness,
    autonomy,
    dependencies,
    drift,
  };
}
