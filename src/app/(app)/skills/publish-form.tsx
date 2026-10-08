"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { type FormState, publishSkillAction } from "../marketplace/actions";

export function PublishForm({ skillId }: { skillId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    publishSkillAction,
    undefined,
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="skillId" value={skillId} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pub-title">Title</Label>
        <Input
          id="pub-title"
          name="title"
          required
          placeholder="e.g. PRD Writing for client agencies"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pub-pitch">Pitch</Label>
        <Textarea
          id="pub-pitch"
          name="pitch"
          required
          rows={3}
          placeholder="Why another org would want to use this agent."
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pub-repo">
          GitHub repo{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="pub-repo"
          name="githubRepo"
          type="url"
          placeholder="https://github.com/you/your-repo"
        />
      </div>
      {state?.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Publishing…" : "Publish"}
      </Button>
    </form>
  );
}
