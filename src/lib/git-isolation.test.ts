import { describe, expect, it } from "vitest";
import { generateGitIsolation } from "./git-isolation";

describe("generateGitIsolation", () => {
  it("generates deterministic branch and worktree for standard titles", () => {
    const res = generateGitIsolation(
      "T-1",
      "Setup Core Database Schema & Migrations",
    );

    expect(res.suggestedBranch).toBe(
      "task/t-1-setup-core-database-schema-migrations",
    );
    expect(res.worktreeDir).toBe(".worktrees/t-1");
    expect(res.worktreeCommand).toBe(
      "git worktree add .worktrees/t-1 -b task/t-1-setup-core-database-schema-migrations origin/main",
    );
    expect(res.checkoutCommand).toBe(
      "git checkout -b task/t-1-setup-core-database-schema-migrations",
    );
    expect(res.cleanupCommand).toBe("git worktree remove .worktrees/t-1");
    expect(res.instructions).toContain(".worktrees/t-1");
  });

  it("handles emojis, punctuation, and special characters cleanly", () => {
    const res = generateGitIsolation(
      "T-12",
      "🚀 Fix: OAuth 2.0 Auth-Consent & DCR Loopback (Bug #404)!!",
    );

    expect(res.suggestedBranch).toBe(
      "task/t-12-fix-oauth-2-0-auth-consent-dcr-loopback-bug",
    );
    expect(res.worktreeDir).toBe(".worktrees/t-12");
  });

  it("handles long titles by cleanly truncating without trailing dashes", () => {
    const res = generateGitIsolation(
      "T-99",
      "This is an extremely long task title that describes very detailed requirements for the platform in one sentence",
    );

    expect(res.suggestedBranch.length).toBeLessThan(60);
    expect(res.suggestedBranch.endsWith("-")).toBe(false);
  });

  it("handles titles with only symbols gracefully", () => {
    const res = generateGitIsolation("T-5", "--- !!! ??? ---");
    expect(res.suggestedBranch).toBe("task/t-5");
    expect(res.worktreeDir).toBe(".worktrees/t-5");
  });
});
