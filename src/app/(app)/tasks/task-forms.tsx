"use client";

import { Check, Plus, RefreshCw, Sparkles, Undo2 } from "lucide-react";
import { useActionState, useState } from "react";
import { RichEditor } from "@/components/rich-editor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionSelect } from "@/components/ui/option-select";
import { Textarea } from "@/components/ui/textarea";
import type { PrdOption } from "@/lib/requirements";
import {
  createTaskAction,
  type FormState,
  retractSubmissionAction,
  runPersonaReviewAction,
  setProjectGithubRepoAction,
  taskDecisionAction,
  verifySubmissionAction,
} from "./actions";
import { RequirementPicker } from "./requirement-picker";

const Status = ({ state }: { state: FormState }) =>
  state?.error ? (
    <p role="alert" className="text-sm text-destructive">
      {state.error}
    </p>
  ) : null;

export function NewTaskDialog({
  projectId,
  agents,
  prds,
}: {
  projectId: string;
  prds: PrdOption[];
  /** Specialist agents (skill names) available in this project. */
  agents: string[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<FormState, FormData>(
    async (prev, form) => {
      const res = await createTaskAction(prev, form);
      if (res?.ok) setOpen(false);
      return res;
    },
    undefined,
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus />
          New task
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>
            Agents pick it up from the board or over MCP. Clear acceptance
            criteria make the reviews and drift check sharper.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="projectId" value={projectId} />
          <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-title">Title</Label>
              <Input id="task-title" name="title" required maxLength={200} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-role">Role</Label>
              <OptionSelect
                id="task-role"
                name="role"
                defaultValue="developer"
                options={[
                  { value: "developer", label: "Developer" },
                  { value: "devops", label: "DevOps" },
                  { value: "qa", label: "QA" },
                  { value: "product", label: "Product" },
                ]}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-agent">Agent</Label>
            <OptionSelect
              id="task-agent"
              name="agent"
              defaultValue="auto"
              options={[
                { value: "auto", label: "Auto-match from the task" },
                ...agents.map((a) => ({ value: a, label: a })),
              ]}
            />
          </div>
          <RequirementPicker prds={prds} idPrefix="new-task" />
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Description</span>
            <RichEditor
              name="description"
              value=""
              minHeight="min-h-40"
              ariaLabel="Description"
              placeholder="What to build, and the acceptance criteria…"
            />
          </div>
          <Status state={state} />
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DecisionForm({
  taskId,
  projectId,
  status,
  agents,
  canApprove,
  blockingReviews = [],
}: {
  taskId: string;
  projectId: string;
  status: string;
  /** Whether the viewer's role has "Approve work" in this project. */
  canApprove: boolean;
  /** Agents a send-back note can be saved to as a learned rule. */
  agents: string[];
  /** Review skill names blocking approval right now (spec 024). */
  blockingReviews?: string[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    taskDecisionAction,
    undefined,
  );
  const [override, setOverride] = useState(false);
  const blocked = blockingReviews.length > 0;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="projectId" value={projectId} />
      {status === "in_review" ? (
        <>
          {blocked && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
              <p className="font-medium text-destructive">
                Blocked by {blockingReviews.join(", ")}
              </p>
              <p className="mt-1 text-muted-foreground">
                Fix the findings above, or approve anyway with a reason below.
              </p>
            </div>
          )}
          <Textarea
            name="note"
            rows={3}
            maxLength={2000}
            aria-label="Note for the agent"
            placeholder={
              blocked && override
                ? "Required: why you're approving over a blocking review"
                : "Required when sending back: what exactly must change"
            }
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="addToLearnedRules"
                value="true"
                defaultChecked
                className="size-4 accent-primary"
              />
              When sending back, teach the note to agent
            </label>
            <OptionSelect
              name="targetSkillName"
              label="Agent that learns the rule"
              defaultValue={
                agents.includes("code-review") ? "code-review" : agents[0]
              }
              className="w-48"
              options={agents.map((a) => ({ value: a, label: a }))}
            />
          </div>
          {blocked && canApprove && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="overrideBlocking"
                value="true"
                checked={override}
                onChange={(e) => setOverride(e.target.checked)}
                className="size-4 accent-destructive"
              />
              Approve anyway, despite the blocking review
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            {canApprove && (!blocked || override) && (
              <Button
                type="submit"
                name="action"
                value="approve"
                variant={blocked ? "destructive" : "default"}
                disabled={pending}
              >
                <Check />
                {blocked ? "Approve anyway" : "Approve"}
              </Button>
            )}
            <Button
              type="submit"
              name="action"
              value="reject"
              variant="outline"
              disabled={pending}
            >
              <Undo2 />
              Send back
            </Button>
          </div>
          {!canApprove && (
            <p className="text-xs text-muted-foreground">
              Your role can&apos;t approve work. Ask someone with the Approve
              work permission.
            </p>
          )}
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">Agent stuck or gone?</span>
          <Button
            type="submit"
            name="action"
            value="release"
            variant="outline"
            size="sm"
            disabled={pending}
          >
            Release back to To do
          </Button>
        </div>
      )}
      <Status state={state} />
    </form>
  );
}

export function RetractSubmissionButton({
  taskId,
  projectId,
}: {
  taskId: string;
  projectId: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    retractSubmissionAction,
    undefined,
  );
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="projectId" value={projectId} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        <Undo2 />
        {pending ? "Taking back…" : "Take back"}
      </Button>
      {state?.error && (
        <span className="text-xs text-destructive">{state.error}</span>
      )}
    </form>
  );
}

export function VerifySubmissionButton({
  submissionId,
  taskId,
}: {
  submissionId: string;
  taskId: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    verifySubmissionAction,
    undefined,
  );
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="submissionId" value={submissionId} />
      <input type="hidden" name="taskId" value={taskId} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        <RefreshCw className={pending ? "animate-spin" : undefined} />
        {pending ? "Checking GitHub…" : "Verify on GitHub"}
      </Button>
      {state?.error && (
        <span className="text-xs text-destructive">{state.error}</span>
      )}
    </form>
  );
}

export function SetGithubRepoForm({
  projectId,
  currentRepo,
}: {
  projectId: string;
  currentRepo?: string | null;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    setProjectGithubRepoAction,
    undefined,
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <Input
        name="githubRepo"
        defaultValue={currentRepo || ""}
        placeholder="owner/repo"
        aria-label="GitHub repository"
        className="w-64 max-w-full font-mono"
      />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
      {state?.error && (
        <span className="text-xs text-destructive">{state.error}</span>
      )}
    </form>
  );
}

export function RunPersonaReviewButton({
  submissionId,
  taskId,
  reviewers,
}: {
  submissionId: string;
  taskId: string;
  /** Reviewer agents available in this project. */
  reviewers: string[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    runPersonaReviewAction,
    undefined,
  );

  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="submissionId" value={submissionId} />
      <input type="hidden" name="taskId" value={taskId} />
      <OptionSelect
        name="skillName"
        label="Reviewer"
        defaultValue="all"
        className="h-7 w-40"
        options={[
          { value: "all", label: "All reviewers" },
          ...reviewers.map((r) => ({ value: r, label: r })),
        ]}
      />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        <Sparkles />
        {pending ? "Reviewing…" : "Run"}
      </Button>
      {state?.error && (
        <span className="text-xs text-destructive">{state.error}</span>
      )}
    </form>
  );
}
