"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { adoptMarketplaceSkillAction, type FormState } from "../actions";

export function AdoptButton({
  marketplaceSkillId,
  agentName,
}: {
  marketplaceSkillId: string;
  agentName: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    adoptMarketplaceSkillAction,
    undefined,
  );

  return (
    <form action={action} className="flex flex-col gap-2">
      <input
        type="hidden"
        name="marketplaceSkillId"
        value={marketplaceSkillId}
      />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Adding…" : `Use this agent as "${agentName}"`}
      </Button>
      <p className="text-xs text-muted-foreground">
        Adds it to your workspace as an org-level agent. If you already have an
        agent named &quot;{agentName}&quot;, this replaces it.
      </p>
      {state?.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}
    </form>
  );
}
