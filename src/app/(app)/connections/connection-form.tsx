"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createConnectionAction, type FormState } from "./actions";
import type { ConnectorKind } from "./connector-catalog";

export const COPY: Record<
  ConnectorKind,
  { label: string; url?: string; secret: string; secretPlaceholder: string }
> = {
  slack_webhook: {
    label: "e.g. #client-approvals",
    secret: "Incoming Webhook URL",
    secretPlaceholder: "https://hooks.slack.com/services/...",
  },
  github_pat: {
    label: "e.g. GitHub verification",
    secret: "Personal access token",
    secretPlaceholder: "ghp_...",
  },
  custom_mcp: {
    label: "e.g. Figma",
    url: "Server URL",
    secret: "Bearer token (optional)",
    secretPlaceholder: "",
  },
};

export function ConnectionForm({
  kind,
  onSaved,
}: {
  kind: ConnectorKind;
  onSaved?: () => void;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    async (prev, form) => {
      const res = await createConnectionAction(prev, form);
      if (!res?.error) onSaved?.();
      return res;
    },
    undefined,
  );
  const copy = COPY[kind];

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="kind" value={kind} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="conn-label">Label</Label>
        <Input id="conn-label" name="label" required placeholder={copy.label} />
      </div>

      {copy.url && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="conn-url">{copy.url}</Label>
          <Input
            id="conn-url"
            name="url"
            type="url"
            required
            placeholder="https://..."
          />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="conn-secret">{copy.secret}</Label>
        <Input
          id="conn-secret"
          name="secret"
          type="password"
          required={kind !== "custom_mcp"}
          placeholder={copy.secretPlaceholder}
        />
      </div>

      {state?.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Verifying…" : "Add connection"}
      </Button>
    </form>
  );
}
