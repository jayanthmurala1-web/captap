"use client";

import { Check, Copy, ExternalLink, GitPullRequest } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { GitIsolation } from "@/lib/git-isolation";
import { synthesizePullRequestAction } from "../actions";

type PrResult = {
  title: string;
  body: string;
  prUrl?: string;
  prNumber?: number;
  createdOnGitHub: boolean;
};

export function BranchCard({
  taskId,
  isolation,
}: {
  taskId: string;
  isolation: GitIsolation;
}) {
  const [pending, start] = useTransition();
  const [pr, setPr] = useState<PrResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openPr = () =>
    start(async () => {
      setError(null);
      const res = await synthesizePullRequestAction(taskId);
      if (res.ok && res.data) setPr(res.data as PrResult);
      else setError(res.error ?? "Couldn't prepare the pull request");
    });

  return (
    <div className="flex flex-col gap-3">
      <CopyRow label="Branch" value={isolation.suggestedBranch} />
      <CopyRow label="Worktree" value={isolation.worktreeCommand} />

      {pr?.createdOnGitHub && pr.prUrl ? (
        <a
          href={pr.prUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <GitPullRequest className="size-4" />
          PR #{pr.prNumber} opened on GitHub
          <ExternalLink className="size-3.5" />
        </a>
      ) : pr ? (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-muted-foreground">
            Not opened on GitHub (no repo or token configured). The description
            is ready to paste:
          </p>
          <CopyButton
            value={`${pr.title}\n\n${pr.body}`}
            label="Copy PR text"
          />
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={openPr}
          disabled={pending}
        >
          <GitPullRequest />
          {pending ? "Preparing…" : "Open pull request"}
        </Button>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1 rounded-lg border bg-muted/50 py-1 pr-1 pl-2.5">
        <code className="min-w-0 flex-1 truncate font-mono text-xs">
          {value}
        </code>
        <CopyButton
          value={value}
          label={`Copy ${label.toLowerCase()}`}
          iconOnly
        />
      </div>
    </div>
  );
}

function CopyButton({
  value,
  label,
  iconOnly,
}: {
  value: string;
  label: string;
  iconOnly?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Button
      type="button"
      variant={iconOnly ? "ghost" : "outline"}
      size={iconOnly ? "icon-xs" : "sm"}
      onClick={copy}
      aria-label={label}
      className={iconOnly ? undefined : "self-start"}
    >
      {copied ? <Check /> : <Copy />}
      {!iconOnly && (copied ? "Copied" : label)}
    </Button>
  );
}
