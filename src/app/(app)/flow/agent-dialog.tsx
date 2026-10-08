"use client";

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
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionSelect } from "@/components/ui/option-select";
import { Textarea } from "@/components/ui/textarea";
import {
  type AgentFormState,
  deleteAgentFromFlowAction,
  saveAgentFromFlowAction,
} from "./agent-actions";

const STARTER = `## How this agent works

1. Validate every input at the route boundary.
2. Add a test that fails if the endpoint's contract breaks.
`;

export type AgentNodeData = {
  /** A real UUID once saved; "default-<name>" for a built-in default never overridden yet. */
  id: string;
  name: string;
  description: string;
  body: string;
  kind: "guide" | "review";
};

export function AgentDialog({
  open,
  onOpenChange,
  agent,
  onSaved,
  onRemoved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = creating a brand-new agent. */
  agent: AgentNodeData | null;
  onSaved: (agent: AgentNodeData) => void;
  onRemoved: (agent: AgentNodeData) => void;
}) {
  const isNew = !agent || agent.id.startsWith("default-");
  const [state, action, pending] = useActionState<AgentFormState, FormData>(
    async (prev, form) => {
      const res = await saveAgentFromFlowAction(prev, form);
      if (res?.ok) {
        const name = String(form.get("name"));
        onSaved({
          id: res.id ?? name,
          name,
          description: String(form.get("description")),
          body: String(form.get("body")),
          kind: form.get("kind") as "guide" | "review",
        });
        onOpenChange(false);
      }
      return res;
    },
    undefined,
  );
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!agent || isNew) return;
    setDeleting(true);
    const res = await deleteAgentFromFlowAction(agent.id);
    setDeleting(false);
    if (res?.ok) {
      onRemoved(agent);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{agent ? agent.name : "Add agent"}</DialogTitle>
          <DialogDescription>
            {agent
              ? "This becomes a node on the canvas. Wire it to a role, then Save routing."
              : "Define what this agent does. Once created it appears as a node you can connect to a role."}
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-4">
          {!isNew && agent && (
            <input type="hidden" name="id" value={agent.id} />
          )}
          <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="flow-agent-name">Name</Label>
              <Input
                id="flow-agent-name"
                name="name"
                required
                maxLength={64}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                title="Lowercase letters, digits and single hyphens, e.g. payments-agent"
                defaultValue={agent?.name}
                disabled={!isNew}
                placeholder="e.g. payments-agent"
                className="font-mono"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="flow-agent-kind">Agent type</Label>
              <OptionSelect
                id="flow-agent-kind"
                name="kind"
                defaultValue={agent?.kind ?? "guide"}
                options={[
                  { value: "guide", label: "Specialist: does the work" },
                  { value: "review", label: "Reviewer: checks submitted work" },
                ]}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="flow-agent-description">What it does</Label>
            <Textarea
              id="flow-agent-description"
              name="description"
              required
              maxLength={1024}
              rows={2}
              defaultValue={agent?.description}
              placeholder="One or two sentences. Agents use this to decide when this playbook applies."
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Playbook</span>
            <RichEditor
              name="body"
              value={agent?.body ?? STARTER}
              minHeight="min-h-48"
              ariaLabel="Playbook"
              placeholder="How this agent should do (or check) the work…"
            />
          </div>
          {state?.error && (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          )}
          <DialogFooter className="justify-between sm:justify-between">
            {!isNew ? (
              <Button
                type="button"
                variant="ghost"
                onClick={handleDelete}
                disabled={deleting || pending}
                className="text-destructive hover:text-destructive"
              >
                {deleting ? "Removing…" : "Remove agent"}
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : isNew ? "Add to canvas" : "Save agent"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
