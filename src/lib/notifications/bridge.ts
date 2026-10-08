import { ValidationError } from "../errors";

export interface SlackBlockKitPayload {
  text: string;
  blocks: Array<Record<string, unknown>>;
}

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbedPayload {
  content?: string;
  embeds: Array<{
    title: string;
    description?: string;
    color: number;
    fields: DiscordEmbedField[];
    footer?: { text: string; icon_url?: string };
    timestamp?: string;
  }>;
}

export interface NotificationResult {
  success: boolean;
  status: number;
  channel: "slack" | "discord";
  error?: string;
}

const EVENT_TITLES: Record<
  string,
  { title: string; emoji: string; color: number }
> = {
  "task.created": { title: "New Task Created", emoji: "✨", color: 0x3b82f6 },
  "task.claimed": { title: "Task Claimed", emoji: "🎯", color: 0x06b6d4 },
  "task.submitted": {
    title: "Task Submitted for Review",
    emoji: "🚀",
    color: 0x8b5cf6,
  },
  "task.approved": { title: "Task Approved", emoji: "✅", color: 0x22c55e },
  "task.rejected": {
    title: "Task Rejected / Needs Work",
    emoji: "❌",
    color: 0xef4444,
  },
  "task.handoff": {
    title: "Specialist Swarm Handoff",
    emoji: "🔄",
    color: 0xa855f7,
  },
  "worktree.provisioned": {
    title: "Git Worktree Allocated",
    emoji: "🌿",
    color: 0x0ea5e9,
  },
  "worktree.healed": {
    title: "Worktree CI Self-Healed",
    emoji: "🩹",
    color: 0x10b981,
  },
  "pr.synthesized": {
    title: "Pull Request Synthesized",
    emoji: "🔀",
    color: 0x6366f1,
  },
  "doc.published": {
    title: "Architecture Spec Published",
    emoji: "📝",
    color: 0xec4899,
  },
  ping: { title: "Diagnostic Channel Ping", emoji: "📡", color: 0x22c55e },
};

/**
 * Formats standard Project OS webhook events into Slack Block Kit payload.
 */
export function formatSlackMessage(
  event: string,
  payload: Record<string, unknown>,
): SlackBlockKitPayload {
  const meta = EVENT_TITLES[event] || {
    title: `Event: ${event}`,
    emoji: "🔔",
    color: 0x64748b,
  };

  const taskKey =
    (payload.taskKey as string) ||
    (payload.taskId ? String(payload.taskId).slice(0, 8) : "N/A");
  const title =
    (payload.title as string) ||
    (payload.summary as string) ||
    "System Notification";
  const agent =
    (payload.agent as string) ||
    (payload.claimedAgent as string) ||
    (payload.decidedBy as string) ||
    "System";
  const note =
    (payload.note as string) ||
    (payload.decisionNote as string) ||
    (payload.rootCause as string);

  const fallbackText = `${meta.emoji} [Project OS] ${meta.title} — ${taskKey}: ${title}`;

  const fields: Array<{ type: string; text: string }> = [
    { type: "mrkdwn", text: `*Task:*\n${taskKey}` },
    { type: "mrkdwn", text: `*Actor / Agent:*\n${agent}` },
  ];

  if (payload.branch) {
    fields.push({ type: "mrkdwn", text: `*Branch:*\n\`${payload.branch}\`` });
  }
  if (payload.commitSha) {
    fields.push({
      type: "mrkdwn",
      text: `*Commit:*\n\`${String(payload.commitSha).slice(0, 7)}\``,
    });
  }

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${meta.emoji} ${meta.title}`,
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${title}*`,
      },
      fields,
    },
  ];

  if (note) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Details / Review Note:*\n>${note.replace(/\n/g, "\n>")}`,
      },
    });
  }

  if (payload.prUrl) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "View Pull Request ↗",
            emoji: true,
          },
          url: payload.prUrl,
          style: "primary",
        },
      ],
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Project OS Cloud Notification • <!date^${Math.floor(Date.now() / 1000)}^{date_num} {time_secs}|${new Date().toISOString()}>`,
      },
    ],
  });

  return { text: fallbackText, blocks };
}

/**
 * Formats standard Project OS webhook events into Discord Embed payload.
 */
export function formatDiscordMessage(
  event: string,
  payload: Record<string, unknown>,
): DiscordEmbedPayload {
  const meta = EVENT_TITLES[event] || {
    title: `Event: ${event}`,
    emoji: "🔔",
    color: 0x64748b,
  };

  const taskKey =
    (payload.taskKey as string) ||
    (payload.taskId ? String(payload.taskId).slice(0, 8) : "N/A");
  const title =
    (payload.title as string) ||
    (payload.summary as string) ||
    "System Notification";
  const agent =
    (payload.agent as string) ||
    (payload.claimedAgent as string) ||
    (payload.decidedBy as string) ||
    "System";
  const note =
    (payload.note as string) ||
    (payload.decisionNote as string) ||
    (payload.rootCause as string);

  const fields: DiscordEmbedField[] = [
    { name: "Task Key", value: taskKey, inline: true },
    { name: "Agent / Actor", value: agent, inline: true },
  ];

  if (payload.stage) {
    fields.push({
      name: "Swarm Stage",
      value: String(payload.stage),
      inline: true,
    });
  }
  if (payload.branch) {
    fields.push({
      name: "Branch",
      value: `\`${payload.branch}\``,
      inline: true,
    });
  }
  if (payload.commitSha) {
    fields.push({
      name: "Commit SHA",
      value: `\`${String(payload.commitSha).slice(0, 7)}\``,
      inline: true,
    });
  }
  if (note) {
    fields.push({
      name: "Review Notes / Diagnosis",
      value: note.slice(0, 1024),
      inline: false,
    });
  }

  const embed: DiscordEmbedPayload["embeds"][0] = {
    title: `${meta.emoji} ${meta.title} — ${title}`,
    color: meta.color,
    fields,
    timestamp: new Date().toISOString(),
    footer: { text: "Project OS Autonomous Notification Bridge" },
  };

  if (payload.prUrl) {
    embed.description = `[View Pull Request on GitHub](${payload.prUrl})`;
  }

  return { embeds: [embed] };
}

/**
 * Sends a rich Block Kit notification to a Slack incoming webhook endpoint.
 */
export async function sendSlackNotification(
  webhookUrl: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<NotificationResult> {
  const body = formatSlackMessage(event, payload);
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return {
      success: res.ok,
      status: res.status,
      channel: "slack",
      error: res.ok
        ? undefined
        : `Slack HTTP ${res.status}: ${await res.text().catch(() => "")}`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, status: 0, channel: "slack", error: message };
  }
}

/**
 * Sends a rich Embed notification to a Discord incoming webhook endpoint.
 */
export async function sendDiscordNotification(
  webhookUrl: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<NotificationResult> {
  const body = formatDiscordMessage(event, payload);
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return {
      success: res.ok,
      status: res.status,
      channel: "discord",
      error: res.ok
        ? undefined
        : `Discord HTTP ${res.status}: ${await res.text().catch(() => "")}`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, status: 0, channel: "discord", error: message };
  }
}

/**
 * Validates and runs a test notification ping against a Slack or Discord webhook.
 */
export async function testNotificationChannel(
  channelType: "slack" | "discord",
  webhookUrl: string,
): Promise<{ success: boolean; message: string; status: number }> {
  if (!webhookUrl || typeof webhookUrl !== "string") {
    throw new ValidationError("Valid webhook URL is required.");
  }

  const url = webhookUrl.trim();
  // Parse, don't substring-match: "https://evil/?hooks.slack.com" must not pass (this makes the server send a request).
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError("Valid webhook URL is required.");
  }
  const hostOk =
    channelType === "slack"
      ? parsed.hostname === "hooks.slack.com" &&
        parsed.pathname.startsWith("/services/")
      : (parsed.hostname === "discord.com" ||
          parsed.hostname === "discordapp.com") &&
        parsed.pathname.startsWith("/api/webhooks/");
  if (parsed.protocol !== "https:" || !hostOk) {
    throw new ValidationError(
      channelType === "slack"
        ? "Slack webhook URLs must begin with https://hooks.slack.com/services/..."
        : "Discord webhook URLs must begin with https://discord.com/api/webhooks/...",
    );
  }

  const testPayload = {
    taskKey: "T-PING",
    title: "Diagnostic Connectivity Check",
    agent: "antigravity-bridge",
    note: "Your Project OS enterprise webhook bridge is successfully connected and receiving events.",
  };

  const result =
    channelType === "slack"
      ? await sendSlackNotification(url, "ping", testPayload)
      : await sendDiscordNotification(url, "ping", testPayload);

  return {
    success: result.success,
    status: result.status,
    message: result.success
      ? `Ping delivered successfully to ${channelType}.`
      : `Delivery failed to ${channelType}: ${result.error || "Unknown error"}`,
  };
}
