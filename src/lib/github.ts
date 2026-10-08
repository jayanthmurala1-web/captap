import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  project,
  task,
  taskSubmission,
  type VerificationDetails,
} from "@/db/schema";
import { requireProject, requireProjectCapability } from "./access";
import { recordAudit } from "./audit";
import { NotFoundError, ValidationError } from "./errors";

export interface GitHubCommitVerification {
  commitExists: boolean;
  commitUrl?: string;
  commitAuthor?: string;
  commitMessage?: string;
  branchExists?: boolean;
  ciStatus: "success" | "failure" | "pending" | "none";
  ciDetails?: Array<{
    name: string;
    status: string;
    conclusion: string | null;
    url?: string;
  }>;
  prNumber?: number;
  prUrl?: string;
  prState?: "open" | "closed" | "merged";
  error?: string;
}

/**
 * Normalizes user input into `{ owner, repo }`
 * Accepts "owner/repo", "https://github.com/owner/repo", "git@github.com:owner/repo.git"
 */
export function parseGitHubRepo(input: string): {
  owner: string;
  repo: string;
} {
  const trimmed = input.trim();
  const match = trimmed.match(
    /(?:github\.com[/:])?([^/:]+)\/([^/.]+)(?:\.git)?$/,
  );
  if (!match) {
    throw new ValidationError(
      `Invalid GitHub repository format: "${input}". Expected "owner/repo" or GitHub URL.`,
    );
  }
  return { owner: match[1], repo: match[2] };
}

/**
 * Calls the GitHub REST API using the configured GITHUB_TOKEN or unauthenticated for public repos.
 */
export async function fetchGitHub(
  endpoint: string,
  optionsOrHeaders?: Record<string, string> | RequestInit,
): Promise<Response> {
  const token = process.env.GITHUB_TOKEN;
  const isRequestInit =
    optionsOrHeaders &&
    ("method" in optionsOrHeaders ||
      "body" in optionsOrHeaders ||
      "headers" in optionsOrHeaders);

  const init: RequestInit = isRequestInit
    ? (optionsOrHeaders as RequestInit)
    : {};
  const extraHeaders = isRequestInit
    ? ((optionsOrHeaders as RequestInit).headers as
        | Record<string, string>
        | undefined)
    : (optionsOrHeaders as Record<string, string> | undefined);

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "ProjectOS-Verifier/1.0",
    ...extraHeaders,
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const url = endpoint.startsWith("https://")
    ? endpoint
    : `https://api.github.com${endpoint}`;

  return await fetch(url, { ...init, headers });
}

/**
 * Fetches unified diff text for a commit. Truncated if exceedingly large.
 */
export async function fetchCommitDiff(
  owner: string,
  repo: string,
  commitSha: string,
): Promise<string | null> {
  try {
    const res = await fetchGitHub(
      `/repos/${owner}/${repo}/commits/${commitSha}`,
      { Accept: "application/vnd.github.v3.diff" },
    );
    if (!res.ok) return null;
    const diff = await res.text();
    // Safety cap at ~25,000 characters to fit smoothly in LLM context windows
    return diff.length > 25000
      ? `${diff.slice(0, 25000)}\n\n[Diff truncated for review...]`
      : diff;
  } catch {
    return null;
  }
}

/**
 * Queries GitHub API to verify commit, branch, CI check runs, and PR association.
 */
export async function verifyOnGitHub(
  repoInput: string,
  commitSha?: string | null,
  branch?: string | null,
): Promise<GitHubCommitVerification> {
  const { owner, repo } = parseGitHubRepo(repoInput);

  if (!commitSha) {
    return {
      commitExists: false,
      ciStatus: "none",
      error: "No commit SHA provided in task submission.",
    };
  }

  const result: GitHubCommitVerification = {
    commitExists: false,
    ciStatus: "none",
  };

  try {
    // 1. Verify commit exists
    const commitRes = await fetchGitHub(
      `/repos/${owner}/${repo}/commits/${commitSha}`,
    );
    if (!commitRes.ok) {
      if (commitRes.status === 404 || commitRes.status === 422) {
        return {
          commitExists: false,
          ciStatus: "none",
          error: `Commit ${commitSha} not found in ${owner}/${repo}.`,
        };
      }
      return {
        commitExists: false,
        ciStatus: "none",
        error: `GitHub API error (${commitRes.status}): ${commitRes.statusText}`,
      };
    }

    const commitData = await commitRes.json();
    result.commitExists = true;
    result.commitUrl = commitData.html_url;
    result.commitAuthor =
      commitData.commit?.author?.name || commitData.author?.login;
    result.commitMessage = commitData.commit?.message?.split("\n")[0];

    // 2. Verify branch exists (if specified)
    if (branch) {
      const branchRes = await fetchGitHub(
        `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`,
      );
      result.branchExists = branchRes.ok;
    }

    // 3. Verify CI check runs (GitHub Actions)
    const checkRunsRes = await fetchGitHub(
      `/repos/${owner}/${repo}/commits/${commitSha}/check-runs`,
    );
    if (checkRunsRes.ok) {
      const checkRunsData = await checkRunsRes.json();
      type GitHubCheckRun = {
        name: string;
        status: string;
        conclusion: string | null;
        html_url?: string;
      };
      const checkRuns = (checkRunsData.check_runs ?? []) as GitHubCheckRun[];

      if (checkRuns.length > 0) {
        result.ciDetails = checkRuns.map((cr) => ({
          name: cr.name,
          status: cr.status,
          conclusion: cr.conclusion,
          url: cr.html_url,
        }));

        const hasFailure = checkRuns.some((cr) => cr.conclusion === "failure");
        const hasPending = checkRuns.some(
          (cr) => cr.status === "in_progress" || cr.status === "queued",
        );

        if (hasFailure) {
          result.ciStatus = "failure";
        } else if (hasPending) {
          result.ciStatus = "pending";
        } else {
          result.ciStatus = "success";
        }
      } else {
        // Fallback: Check commit statuses
        const statusesRes = await fetchGitHub(
          `/repos/${owner}/${repo}/commits/${commitSha}/statuses`,
        );
        if (statusesRes.ok) {
          const statusesData = await statusesRes.json();
          if (statusesData.length > 0) {
            const latestState = statusesData[0].state;
            if (latestState === "success") result.ciStatus = "success";
            else if (latestState === "failure" || latestState === "error")
              result.ciStatus = "failure";
            else if (latestState === "pending") result.ciStatus = "pending";
          }
        }
      }
    }

    // 4. Discover linked Pull Request
    const pullsRes = await fetchGitHub(
      `/repos/${owner}/${repo}/commits/${commitSha}/pulls`,
    );
    if (pullsRes.ok) {
      const pullsData = await pullsRes.json();
      if (pullsData.length > 0) {
        const pr = pullsData[0];
        result.prNumber = pr.number;
        result.prUrl = pr.html_url;
        result.prState = pr.merged_at ? "merged" : pr.state;
      }
    }

    return result;
  } catch (err) {
    return {
      commitExists: false,
      ciStatus: "none",
      error: `Network error verifying on GitHub: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Verifies a task submission against its project's configured GitHub repo and persists the result.
 */
export async function verifyTaskSubmission(
  userId: string,
  submissionId: string,
): Promise<VerificationDetails> {
  const [sub] = await db
    .select({
      id: taskSubmission.id,
      commitSha: taskSubmission.commitSha,
      branch: taskSubmission.branch,
      projectId: task.projectId,
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

  const verifiedAt = new Date().toISOString();

  if (!sub.githubRepo) {
    const details: VerificationDetails = {
      commitExists: false,
      ciStatus: "none",
      verifiedAt,
      error: "No GitHub repository linked to this project.",
    };
    await db
      .update(taskSubmission)
      .set({
        verificationStatus: "unverified",
        verificationDetails: details,
      })
      .where(eq(taskSubmission.id, submissionId));
    return details;
  }

  const check = await verifyOnGitHub(sub.githubRepo, sub.commitSha, sub.branch);

  const isVerified =
    check.commitExists && check.ciStatus !== "failure" && !check.error;

  const verificationStatus = isVerified
    ? "verified"
    : check.error || check.ciStatus === "failure"
      ? "failed"
      : "unverified";

  const details: VerificationDetails = {
    ...check,
    verifiedAt,
  };

  await db
    .update(taskSubmission)
    .set({
      verificationStatus,
      verificationDetails: details,
    })
    .where(eq(taskSubmission.id, submissionId));

  return details;
}

/**
 * Links a project to a GitHub repository (e.g. "owner/repo"). Admins only.
 */
export async function setProjectGithubRepo(
  userId: string,
  projectId: string,
  repo: string | null,
): Promise<{ projectId: string; githubRepo: string | null }> {
  const { orgId } = await requireProjectCapability(
    userId,
    projectId,
    "manage_project_settings",
  );

  const normalized = repo ? parseGitHubRepo(repo) : null;
  const githubRepo = normalized
    ? `${normalized.owner}/${normalized.repo}`
    : null;

  const [updated] = await db
    .update(project)
    .set({ githubRepo, updatedAt: new Date() })
    .where(eq(project.id, projectId))
    .returning({ id: project.id, githubRepo: project.githubRepo });

  if (!updated) {
    throw new NotFoundError("Project not found");
  }
  await recordAudit(db, {
    orgId,
    projectId: updated.id,
    actorId: userId,
    action: "project.github_linked",
    targetType: "project",
    targetId: updated.id,
    targetLabel: updated.githubRepo ?? "(unlinked)",
  });

  return { projectId: updated.id, githubRepo: updated.githubRepo };
}
