"use client";

import { Sparkles } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { createSampleProjectAction, type FormState } from "./actions";

export function SampleProjectButton() {
  const [state, action, pending] = useActionState<FormState, FormData>(
    createSampleProjectAction,
    undefined,
  );
  return (
    <form action={action} className="flex items-center gap-2">
      <Button type="submit" variant="outline" disabled={pending}>
        <Sparkles />
        {pending ? "Setting up…" : "Try a sample project"}
      </Button>
      {state?.error && (
        <span className="text-sm text-destructive">{state.error}</span>
      )}
    </form>
  );
}
