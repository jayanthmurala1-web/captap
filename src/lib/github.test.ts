import { describe, expect, it } from "vitest";
import { ValidationError } from "./errors";
import { parseGitHubRepo, verifyOnGitHub } from "./github";

describe("GitHub Verification (Spec 007)", () => {
  it("parses valid GitHub repository formats accurately", () => {
    expect(parseGitHubRepo("facebook/react")).toEqual({
      owner: "facebook",
      repo: "react",
    });

    expect(parseGitHubRepo("https://github.com/facebook/react")).toEqual({
      owner: "facebook",
      repo: "react",
    });

    expect(parseGitHubRepo("https://github.com/facebook/react.git")).toEqual({
      owner: "facebook",
      repo: "react",
    });

    expect(parseGitHubRepo("git@github.com:facebook/react.git")).toEqual({
      owner: "facebook",
      repo: "react",
    });
  });

  it("rejects invalid repository formats with ValidationError", () => {
    expect(() => parseGitHubRepo("invalid-format")).toThrowError(
      ValidationError,
    );
    expect(() => parseGitHubRepo("")).toThrowError(ValidationError);
  });

  it("returns an error result if commit SHA is missing", async () => {
    const res = await verifyOnGitHub("facebook/react", null, null);
    expect(res.commitExists).toBe(false);
    expect(res.error).toBeDefined();
  });

  it("verifies real public commits against the GitHub API", async () => {
    // Testing against a stable public commit in facebook/react
    const knownSha = "59aff3e18cb5b3a336c280bbfa57ec37999511b9";
    const res = await verifyOnGitHub("facebook/react", knownSha, "main");

    expect(res.commitExists).toBe(true);
    expect(res.commitUrl).toContain(knownSha);
  });

  it("reports not found for non-existent commits", async () => {
    const fakeSha = "0000000000000000000000000000000000000000";
    const res = await verifyOnGitHub("facebook/react", fakeSha);

    expect(res.commitExists).toBe(false);
    expect(res.error).toContain("not found");
  });
});
