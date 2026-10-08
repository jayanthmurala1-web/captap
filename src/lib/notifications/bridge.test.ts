import { describe, expect, test, vi } from "vitest";
import {
  formatDiscordMessage,
  formatSlackMessage,
  sendDiscordNotification,
  sendSlackNotification,
  testNotificationChannel,
} from "./bridge";

describe("Phase 4.0: Enterprise Notification & Event Bridge", () => {
  test("formatSlackMessage generates valid Block Kit with header, fields, and note", () => {
    const payload = {
      taskKey: "T-102",
      title: "Self-Healing Worktree Complete",
      agent: "ci-doctor",
      branch: "task/t-102-self-heal",
      commitSha: "a1b2c3d4e5f6",
      note: "All unit tests pass cleanly after applying learned rule #4",
      prUrl: "https://github.com/project-os/repo/pull/42",
    };

    const slack = formatSlackMessage("worktree.healed", payload);
    expect(slack.text).toContain("Worktree CI Self-Healed");
    expect(slack.text).toContain("T-102");
    expect(slack.blocks.length).toBeGreaterThanOrEqual(4);

    const header = slack.blocks.find((b) => b.type === "header");
    expect(header).toBeDefined();

    const section = slack.blocks.find((b) => b.type === "section" && b.fields);
    expect(section).toBeDefined();
    const fields = section?.fields as Array<{ text: string }>;
    expect(fields.some((f) => f.text.includes("T-102"))).toBe(true);
    expect(fields.some((f) => f.text.includes("ci-doctor"))).toBe(true);
    expect(fields.some((f) => f.text.includes("task/t-102-self-heal"))).toBe(
      true,
    );

    const actions = slack.blocks.find((b) => b.type === "actions");
    expect(actions).toBeDefined();
  });

  test("formatDiscordMessage generates rich embed with color and fields", () => {
    const payload = {
      taskKey: "T-404",
      title: "Feature Rejection Notice",
      agent: "human-reviewer",
      note: "Missing error boundaries on checkout route",
    };

    const discord = formatDiscordMessage("task.rejected", payload);
    expect(discord.embeds.length).toBe(1);

    const embed = discord.embeds[0];
    expect(embed.title).toContain("Task Rejected");
    expect(embed.color).toBe(0xef4444); // Red
    expect(embed.fields.length).toBeGreaterThanOrEqual(3);
    expect(
      embed.fields.some((f) => f.name === "Task Key" && f.value === "T-404"),
    ).toBe(true);
    expect(
      embed.fields.some((f) => f.value.includes("Missing error boundaries")),
    ).toBe(true);
  });

  test("testNotificationChannel rejects invalid webhook URLs", async () => {
    await expect(
      testNotificationChannel("slack", "https://invalid-slack.com/endpoint"),
    ).rejects.toThrow("Slack webhook URLs must begin with");

    await expect(
      testNotificationChannel("discord", "https://not-discord.com/hook"),
    ).rejects.toThrow("Discord webhook URLs must begin with");
  });

  test("testNotificationChannel only posts to the real Slack/Discord hosts over https", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    for (const [kind, url] of [
      ["slack", "http://169.254.169.254/?hooks.slack.com"],
      ["slack", "https://evil.example.com/hooks.slack.com/services/x"],
      ["slack", "http://hooks.slack.com/services/x"],
      ["discord", "https://attacker.test/discord.com/api/webhooks/1"],
    ] as const) {
      await expect(testNotificationChannel(kind, url)).rejects.toThrow();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  test("sendSlackNotification and sendDiscordNotification post JSON to endpoints", async () => {
    const originalFetch = global.fetch;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "ok",
    });
    global.fetch = fetchMock;

    try {
      const slackRes = await sendSlackNotification(
        "https://hooks.slack.com/services/T00/B00/X00",
        "task.approved",
        { taskKey: "T-1", title: "All good" },
      );
      expect(slackRes.success).toBe(true);
      expect(slackRes.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const discordRes = await sendDiscordNotification(
        "https://discord.com/api/webhooks/123/abc",
        "task.approved",
        { taskKey: "T-1", title: "All good" },
      );
      expect(discordRes.success).toBe(true);
      expect(discordRes.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
