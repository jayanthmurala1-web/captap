import { FileCode2, GitBranch, MessageSquare } from "lucide-react";

export type ConnectorKind = "slack_webhook" | "github_pat" | "custom_mcp";

export const CONNECTOR_CATALOG: Record<
  ConnectorKind,
  {
    name: string;
    by: string;
    description: string;
    icon: typeof MessageSquare;
    iconClassName: string;
  }
> = {
  slack_webhook: {
    name: "Slack",
    by: "Slack",
    description: "Post client decisions and review findings to a channel.",
    icon: MessageSquare,
    iconClassName: "bg-[#4A154B]/15 text-[#4A154B] dark:text-[#ECB22E]",
  },
  github_pat: {
    name: "GitHub",
    by: "GitHub",
    description:
      "Verify commits, CI and PRs independently of what an agent reports.",
    icon: GitBranch,
    iconClassName: "bg-foreground/10 text-foreground",
  },
  custom_mcp: {
    name: "Custom MCP server",
    by: "Any MCP server",
    description:
      "Attach any tool that speaks MCP — Figma, an internal tool, anything.",
    icon: FileCode2,
    iconClassName: "bg-primary/15 text-primary",
  },
};
