import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  type CriterionCheck,
  documentVersion,
  project,
  type ReviewFinding,
  type ReviewResult,
  task,
  taskSubmission,
} from "@/db/schema";
import { requireProject } from "./access";
import { REVIEW_MAX_OUTPUT_TOKENS } from "./ai/catalog";
import { recordKeyOutcome, resolveModelAccess } from "./ai/model-access";
import { createChatModel, extractUsage, scrub } from "./ai/providers";
import { recordAgentTelemetry } from "./ai/telemetry";
import { DEFAULT_SKILLS, REQUIREMENT_DRIFT_SKILL } from "./default-skills";
import { NotFoundError } from "./errors";
import { fetchCommitDiff, parseGitHubRepo } from "./github";
import { getEffectiveSkills } from "./skills";

interface PersonaEvaluationInput {
  skillName: string;
  skillSource: string;
  taskTitle: string;
  taskDescription: string;
  summary: string;
  branch: string | null;
  commitSha: string | null;
  filesChanged: string[];
  tests: Array<{ command: string; exitCode: number; summary: string }>;
  diff: string | null;
  prdContent?: string | null;
}

/** Who a review is for and what it is about, so its model usage is metered like any other call (spec 021). */
interface ReviewContext {
  orgId: string;
  userId: string;
  projectId: string;
  taskId: string;
}

/**
 * Extracts and parses JSON from model output, handling optional markdown fences.
 */
export function parseReviewJson(rawText: string): {
  status: "PASS" | "NEEDS_WORK" | "FAIL";
  blocking: boolean;
  summary: string;
  criteriaChecks: CriterionCheck[];
  findings: ReviewFinding[];
} {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    const validStatus =
      parsed.status === "PASS" ||
      parsed.status === "FAIL" ||
      parsed.status === "NEEDS_WORK"
        ? parsed.status
        : "NEEDS_WORK";

    return {
      status: validStatus,
      blocking:
        typeof parsed.blocking === "boolean"
          ? parsed.blocking
          : validStatus === "FAIL",
      summary:
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim()
          : "Review completed.",
      criteriaChecks: Array.isArray(parsed.criteriaChecks)
        ? parsed.criteriaChecks.map((c: Record<string, unknown>) => ({
            criterion: String(c.criterion || "Acceptance Criterion"),
            passed: Boolean(c.passed),
            evidence: c.evidence ? String(c.evidence) : undefined,
          }))
        : [],
      findings: Array.isArray(parsed.findings)
        ? parsed.findings.map((f: Record<string, unknown>) => ({
            severity:
              f.severity === "CRITICAL" ||
              f.severity === "HIGH" ||
              f.severity === "MEDIUM" ||
              f.severity === "LOW"
                ? f.severity
                : "MEDIUM",
            fileLine: f.fileLine ? String(f.fileLine) : undefined,
            problem: String(f.problem || "Unspecified finding"),
            impact: f.impact ? String(f.impact) : undefined,
            fix: f.fix ? String(f.fix) : undefined,
          }))
        : [],
    };
  } catch {
    // If model didn't return valid JSON, extract text gracefully
    return {
      status: "NEEDS_WORK",
      blocking: false,
      summary: rawText.slice(0, 300),
      criteriaChecks: [],
      findings: [
        {
          severity: "LOW",
          problem: "Model returned unstructured review output.",
          fix: "Inspect the raw summary or re-run persona review.",
        },
      ],
    };
  }
}

/**
 * Runs a single persona review using the configured Groq LLM.
 */
async function evaluatePersona(
  input: PersonaEvaluationInput,
  ctx: ReviewContext,
): Promise<ReviewResult> {
  // The org's default provider/model, on the org's own key or its plan (spec 021). No key or no
  // allowance left: the review is skipped and says exactly why, instead of failing silently.
  let access: Awaited<ReturnType<typeof resolveModelAccess>>;
  try {
    access = await resolveModelAccess(ctx.orgId);
  } catch (err) {
    return {
      skill: input.skillName,
      status: "NEEDS_WORK",
      blocking: false,
      summary: `Review skipped: ${err instanceof Error ? err.message : String(err)}`,
      automated: true,
      reviewedAt: new Date().toISOString(),
    };
  }
  const model = createChatModel({
    provider: access.provider,
    model: access.model,
    apiKey: access.apiKey,
    temperature: 0.1,
    maxOutputTokens: REVIEW_MAX_OUTPUT_TOKENS,
  });

  const systemPrompt = `You are an expert, objective reviewer acting strictly under the following Persona Review Skill:

=== SKILL GUIDELINES: ${input.skillName} ===
${input.skillSource}
===========================================

Your job is to rigorously evaluate the agent's completed work against the task's requirements and acceptance criteria.
Evaluate objectively without assuming unproven claims.

Return ONLY valid JSON matching this schema:
{
  "status": "PASS" | "NEEDS_WORK" | "FAIL",
  "blocking": boolean,
  "summary": "1-3 sentence overview of findings and verdict",
  "criteriaChecks": [
    {
      "criterion": "Name or description of acceptance criterion from task",
      "passed": true,
      "evidence": "Explanation of how the code diff or tests fulfill or fail this criterion"
    }
  ],
  "findings": [
    {
      "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
      "fileLine": "file:line if identifiable (optional)",
      "problem": "Clear statement of the issue or discrepancy",
      "impact": "Why this matters to the user, security, or product",
      "fix": "Specific recommended change"
    }
  ]
}`;

  const userPrompt = `TASK TITLE: ${input.taskTitle}

TASK REQUIREMENTS & ACCEPTANCE CRITERIA:
${input.taskDescription || "None specified in task description."}
${
  input.prdContent
    ? `\nLINKED PRD (source of truth this task is built under):\n${input.prdContent}\n`
    : ""
}
AGENT SUBMITTED EVIDENCE:
- Summary: ${input.summary}
- Branch: ${input.branch || "N/A"}
- Commit SHA: ${input.commitSha || "N/A"}
- Files Changed: ${input.filesChanged.length > 0 ? input.filesChanged.join(", ") : "None reported"}
- Test Runs:
${
  input.tests.length > 0
    ? input.tests
        .map(
          (t) => `  • \`${t.command}\` (exit code ${t.exitCode}): ${t.summary}`,
        )
        .join("\n")
    : "  No test runs reported."
}

CODE DIFF:
${
  input.diff
    ? input.diff
    : "No repository diff available. Review strictly based on reported evidence, tests, and task description."
}`;

  const invoke = () =>
    model.invoke([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

  const started = Date.now();
  const purpose =
    input.skillName === REQUIREMENT_DRIFT_SKILL.name ? "drift" : "review";
  const meter = async (
    response: unknown,
    status: "success" | "error",
    errorMessage?: string,
  ) => {
    try {
      const usage = extractUsage(response);
      await recordAgentTelemetry({
        orgId: ctx.orgId,
        projectId: ctx.projectId,
        taskId: ctx.taskId,
        userId: ctx.userId,
        agentName: input.skillName,
        modelProvider: access.provider,
        modelName: access.model,
        keySource: access.keySource,
        purpose,
        inputTokens: usage?.input ?? 0,
        outputTokens: usage?.output ?? 0,
        durationMs: Date.now() - started,
        status,
        errorMessage,
        metadata: usage || status === "error" ? {} : { estimated: true },
      });
      if (access.keySource === "org")
        await recordKeyOutcome(ctx.orgId, access.provider, errorMessage);
    } catch (e) {
      console.error("could not record review usage:", e);
    }
  };

  try {
    let response: Awaited<ReturnType<typeof invoke>>;
    try {
      response = await invoke();
    } catch (err) {
      // Groq's free tier applies a per-minute token limit; a burst of reviews can hit it
      // transiently. One short retry clears most of these instead of surfacing a rate-limit
      // error as if it were a real (if cautious) review verdict.
      const message = err instanceof Error ? err.message : String(err);
      if (!/rate_limit_exceeded|429/.test(message)) throw err;
      await new Promise((r) => setTimeout(r, 6_000));
      response = await invoke();
    }

    await meter(response, "success");
    const content =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    const parsed = parseReviewJson(content);

    return {
      skill: input.skillName,
      status: parsed.status,
      blocking: parsed.blocking,
      summary: parsed.summary,
      findings: parsed.findings,
      criteriaChecks: parsed.criteriaChecks,
      automated: true,
      reviewedAt: new Date().toISOString(),
    };
  } catch (err) {
    const message = scrub(
      err instanceof Error ? err.message : String(err),
      access.apiKey,
    );
    await meter(null, "error", message);
    return {
      skill: input.skillName,
      status: "NEEDS_WORK",
      blocking: false,
      summary: `Automated review error: ${message}`,
      automated: true,
      reviewedAt: new Date().toISOString(),
    };
  }
}

/**
 * Runs automated persona reviews for a task submission and persists the results.
 * Can review all configured review skills or a specific one.
 */
export async function runPersonaReview(
  userId: string,
  submissionId: string,
  skillName?: string,
): Promise<ReviewResult[]> {
  const [sub] = await db
    .select({
      id: taskSubmission.id,
      taskId: taskSubmission.taskId,
      summary: taskSubmission.summary,
      branch: taskSubmission.branch,
      commitSha: taskSubmission.commitSha,
      filesChanged: taskSubmission.filesChanged,
      tests: taskSubmission.tests,
      existingReviews: taskSubmission.reviews,
      projectId: task.projectId,
      orgId: task.orgId,
      taskTitle: task.title,
      taskDescription: task.description,
      prdDocumentId: task.prdDocumentId,
      githubRepo: project.githubRepo,
    })
    .from(taskSubmission)
    .innerJoin(task, eq(taskSubmission.taskId, task.id))
    .innerJoin(project, eq(task.projectId, project.id))
    .where(eq(taskSubmission.id, submissionId));

  if (!sub) {
    throw new NotFoundError("Task submission not found");
  }

  await requireProject(userId, sub.projectId);

  // Fetch review skills for the project
  const allSkills = await getEffectiveSkills(userId, {
    projectId: sub.projectId,
  });
  let targetSkills: Array<{ name: string; source: string }> = allSkills
    .filter((s) => s.kind === "review" && (!skillName || s.name === skillName))
    .map((s) => ({ name: s.name, source: s.source }));

  // If no review skills found in DB, fallback to default review skills
  if (targetSkills.length === 0) {
    targetSkills = DEFAULT_SKILLS.filter((s) => s.kind === "review")
      .map((s) => ({
        name: s.source.match(/^name:\s*([^\n]+)/m)?.[1]?.trim() || "review",
        source: s.source,
      }))
      .filter((s) => !skillName || s.name === skillName);
  }

  // Note: targetSkills may be empty here (e.g. skillName requested a skill that isn't in
  // the org's configured/default list, such as "requirement-drift", which is deliberately
  // never in DEFAULT_SKILLS — spec 012). Execution continues rather than returning early,
  // so the drift check below still runs when applicable; the loop below simply no-ops.

  // Fetch diff from GitHub if commit is present
  let diff: string | null = null;
  if (sub.githubRepo && sub.commitSha) {
    try {
      const { owner, repo } = parseGitHubRepo(sub.githubRepo);
      diff = await fetchCommitDiff(owner, repo, sub.commitSha);
    } catch {
      diff = null;
    }
  }

  // Requirement drift (spec 012): only fetched when the task is built under a PRD (spec 017).
  let prdContent: string | null = null;
  if (sub.prdDocumentId) {
    const [version] = await db
      .select({ content: documentVersion.content })
      .from(documentVersion)
      .where(eq(documentVersion.documentId, sub.prdDocumentId))
      .orderBy(desc(documentVersion.version))
      .limit(1);
    prdContent = version?.content ?? null;
  }

  // Run each target persona review
  const newResults: ReviewResult[] = [];
  for (const skill of targetSkills) {
    const res = await evaluatePersona(
      {
        skillName: skill.name,
        skillSource: skill.source,
        taskTitle: sub.taskTitle,
        taskDescription: sub.taskDescription,
        summary: sub.summary,
        branch: sub.branch,
        commitSha: sub.commitSha,
        filesChanged: sub.filesChanged,
        tests: sub.tests,
        diff,
        prdContent,
      },
      {
        orgId: sub.orgId,
        userId,
        projectId: sub.projectId,
        taskId: sub.taskId,
      },
    );
    newResults.push(res);
  }

  // Requirement drift is not part of DEFAULT_SKILLS — it only runs when a PRD is actually linked,
  // so a submission with no linked PRD incurs no extra review and no extra cost.
  if (
    prdContent &&
    (!skillName || skillName === REQUIREMENT_DRIFT_SKILL.name)
  ) {
    newResults.push(
      await evaluatePersona(
        {
          skillName: REQUIREMENT_DRIFT_SKILL.name,
          skillSource: REQUIREMENT_DRIFT_SKILL.source,
          taskTitle: sub.taskTitle,
          taskDescription: sub.taskDescription,
          summary: sub.summary,
          branch: sub.branch,
          commitSha: sub.commitSha,
          filesChanged: sub.filesChanged,
          tests: sub.tests,
          diff,
          prdContent,
        },
        {
          orgId: sub.orgId,
          userId,
          projectId: sub.projectId,
          taskId: sub.taskId,
        },
      ),
    );
  }

  // Merge with existing reviews
  const existing = (sub.existingReviews as ReviewResult[]) ?? [];
  const mergedMap = new Map<string, ReviewResult>();
  for (const r of existing) {
    mergedMap.set(r.skill, r);
  }
  for (const r of newResults) {
    mergedMap.set(r.skill, r);
  }
  const mergedReviews = [...mergedMap.values()];

  // Persist updated reviews
  await db
    .update(taskSubmission)
    .set({ reviews: mergedReviews })
    .where(eq(taskSubmission.id, submissionId));

  return mergedReviews;
}
