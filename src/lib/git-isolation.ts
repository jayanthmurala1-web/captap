/** Suggested branch/worktree names and commands only. Nothing server-side verifies an agent actually
 * used them: the server never touches the repo, so isolation is advisory, not enforced. */
export interface GitIsolation {
  suggestedBranch: string;
  worktreeDir: string;
  worktreeCommand: string;
  checkoutCommand: string;
  cleanupCommand: string;
  instructions: string;
}

export function generateGitIsolation(
  taskKey: string,
  title: string,
): GitIsolation {
  const cleanKey = taskKey
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
  let slug = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (slug.length > 45) {
    const trimmed = slug.slice(0, 45);
    const lastDash = trimmed.lastIndexOf("-");
    slug = (lastDash > 20 ? trimmed.slice(0, lastDash) : trimmed).replace(
      /-+$/,
      "",
    );
  }

  const suggestedBranch = `task/${cleanKey}${slug ? `-${slug}` : ""}`;
  const worktreeDir = `.worktrees/${cleanKey}`;

  return {
    suggestedBranch,
    worktreeDir,
    worktreeCommand: `git worktree add ${worktreeDir} -b ${suggestedBranch} origin/main`,
    checkoutCommand: `git checkout -b ${suggestedBranch}`,
    cleanupCommand: `git worktree remove ${worktreeDir}`,
    instructions: `To avoid file collisions with parallel agents working on this repo, create and work inside isolated worktree '${worktreeDir}' or branch '${suggestedBranch}' before writing code.`,
  };
}
