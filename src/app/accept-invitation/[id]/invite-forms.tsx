"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import {
  acceptInvitationAction,
  type InviteFormState,
  registerAndAcceptInvitationAction,
} from "./actions";

function ErrorNote({ state }: { state: InviteFormState }) {
  return state?.error ? (
    <p
      role="alert"
      className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
    >
      {state.error}
    </p>
  ) : null;
}

export function AcceptAsSignedIn({
  invitationId,
  orgName,
}: {
  invitationId: string;
  orgName: string;
}) {
  const [state, action, pending] = useActionState<InviteFormState, FormData>(
    () => acceptInvitationAction(invitationId),
    undefined,
  );
  return (
    <form action={action} className="flex flex-col gap-4">
      <ErrorNote state={state} />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Joining…" : `Join ${orgName}`}
      </Button>
    </form>
  );
}

export function RegisterAndAccept({
  invitationId,
  email,
  orgName,
}: {
  invitationId: string;
  email: string;
  orgName: string;
}) {
  const [state, action, pending] = useActionState<InviteFormState, FormData>(
    registerAndAcceptInvitationAction.bind(null, invitationId),
    undefined,
  );
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invited-email">Email</Label>
        <Input
          id="invited-email"
          value={email}
          readOnly
          disabled
          className="h-10"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="user-name">Your name</Label>
        <Input
          id="user-name"
          name="name"
          required
          autoComplete="name"
          className="h-10"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="user-password">Choose a password</Label>
        <Input
          id="user-password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="At least 8 characters"
          className="h-10"
        />
      </div>
      <ErrorNote state={state} />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Joining…" : `Create account and join ${orgName}`}
      </Button>
    </form>
  );
}

export function SignOutLink({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="text-left font-medium text-foreground underline underline-offset-4"
      onClick={() =>
        authClient.signOut({
          fetchOptions: { onSuccess: () => window.location.reload() },
        })
      }
    >
      {label}
    </button>
  );
}
