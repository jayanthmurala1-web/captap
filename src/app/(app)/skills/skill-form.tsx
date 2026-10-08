"use client";

import { useActionState } from "react";
import { RichEditor } from "@/components/rich-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionSelect } from "@/components/ui/option-select";
import { Textarea } from "@/components/ui/textarea";
import { type FormState, saveSkillAction } from "./actions";

const STARTER = `## How this skill works

1. Validate every input at the route boundary.
2. Add a test that fails if the endpoint's contract breaks.
`;

type Props = {
  skill?: {
    id: string;
    kind: "guide" | "review";
    name: string;
    description: string;
    body: string;
  };
  projectId?: string;
};

export function SkillForm({ skill, projectId }: Props) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    saveSkillAction,
    undefined,
  );
  return (
    <form action={action} className="flex flex-col gap-4">
      {skill && <input type="hidden" name="id" value={skill.id} />}
      {projectId && <input type="hidden" name="projectId" value={projectId} />}
      <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="skill-name">Name</Label>
          <Input
            id="skill-name"
            name="name"
            required
            maxLength={64}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            title="Lowercase letters, digits and single hyphens, e.g. payments-skill"
            defaultValue={skill?.name}
            placeholder="e.g. payments-skill"
            className="font-mono"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="skill-kind">Skill type</Label>
          <OptionSelect
            id="skill-kind"
            name="kind"
            defaultValue={skill?.kind ?? "guide"}
            options={[
              { value: "guide", label: "Specialist: does the work" },
              { value: "review", label: "Reviewer: checks submitted work" },
            ]}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="skill-description">What it does</Label>
        <Textarea
          id="skill-description"
          name="description"
          required
          maxLength={1024}
          rows={2}
          defaultValue={skill?.description}
          placeholder="One or two sentences. Agents use this to decide when this playbook applies."
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Playbook</span>
        <RichEditor
          name="body"
          value={skill?.body ?? STARTER}
          minHeight="min-h-64"
          ariaLabel="Playbook"
          placeholder="How this skill should do (or check) the work…"
        />
      </div>
      <details className="text-sm text-muted-foreground">
        <summary className="cursor-pointer">Or upload a SKILL.md file</summary>
        <input
          name="file"
          type="file"
          accept=".md,.txt,text/markdown,text/plain"
          aria-label="SKILL.md file"
          className="mt-2 text-sm file:mr-3 file:rounded-md file:border file:bg-card file:px-2.5 file:py-1 file:text-sm file:text-foreground"
        />
      </details>
      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : skill ? "Save skill" : "Create skill"}
      </Button>
    </form>
  );
}
