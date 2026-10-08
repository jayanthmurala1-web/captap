"use client";

import Link from "next/link";
import { useActionState } from "react";
import { deleteLearnedRuleAction } from "@/app/(app)/tasks/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateShort } from "@/lib/utils";

export type LearnedRule = {
  id: string;
  projectId: string;
  projectName?: string;
  skillName: string;
  rule: string;
  source: string;
  createdAt: Date;
  sourceTaskId: string | null;
  sourceTaskKey?: string;
};

const SOURCE: Record<string, string> = {
  human_critique: "from a send-back",
  persona_review: "from a review",
  manual: "added by hand",
};

/** Rules distilled from sent-back work; matching tasks get them in their agent context. */
export function LearnedRules({
  rules,
  canManage,
  showProject,
}: {
  rules: LearnedRule[];
  canManage: boolean;
  showProject?: boolean;
}) {
  if (rules.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">
        No learned rules yet. When you send work back with a note, you can save
        it as a rule so agents don&apos;t repeat the mistake.
      </p>
    );
  }
  return (
    <ul className="divide-y rounded-2xl border bg-card">
      {rules.map((r) => (
        <RuleRow
          key={r.id}
          r={r}
          canManage={canManage}
          showProject={showProject}
        />
      ))}
    </ul>
  );
}

function RuleRow({
  r,
  canManage,
  showProject,
}: {
  r: LearnedRule;
  canManage: boolean;
  showProject?: boolean;
}) {
  const [state, action, pending] = useActionState(
    deleteLearnedRuleAction,
    undefined,
  );
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm">{r.rule}</p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <Badge variant="secondary">{r.skillName}</Badge>
          {showProject && r.projectName && (
            <Link
              href={`/projects/${r.projectId}`}
              className="hover:text-foreground"
            >
              {r.projectName}
            </Link>
          )}
          <span>
            {SOURCE[r.source] ?? r.source}
            {r.sourceTaskId && r.sourceTaskKey && (
              <>
                {" "}
                <Link
                  href={`/tasks/${r.sourceTaskId}`}
                  className="font-mono hover:text-foreground"
                >
                  {r.sourceTaskKey}
                </Link>
              </>
            )}
          </span>
          <span>{formatDateShort(r.createdAt)}</span>
        </p>
        {state?.error && (
          <p className="mt-1 text-xs text-destructive">{state.error}</p>
        )}
      </div>
      {canManage && (
        <form action={action} className="shrink-0">
          <input type="hidden" name="ruleId" value={r.id} />
          <input type="hidden" name="projectId" value={r.projectId} />
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            disabled={pending}
            className="text-muted-foreground"
          >
            Remove
          </Button>
        </form>
      )}
    </li>
  );
}
