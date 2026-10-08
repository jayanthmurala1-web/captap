"use client";

import { Check, Copy, Send } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionSelect } from "@/components/ui/option-select";
import {
  type InviteState,
  inviteMemberAction,
  type ResendState,
  resendInvitationAction,
} from "../actions";

export function InviteForm({
  roles,
}: {
  roles: { slug: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<InviteState, FormData>(
    inviteMemberAction,
    undefined,
  );
  return (
    <div className="flex flex-col gap-4">
      <form
        action={action}
        className="grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            name="email"
            type="email"
            required
            placeholder="teammate@agency.com"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-role">Role</Label>
          <OptionSelect
            id="invite-role"
            name="role"
            defaultValue="member"
            options={roles.map((r) => ({ value: r.slug, label: r.name }))}
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create invite link"}
        </Button>
      </form>
      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state?.inviteId && (
        <div className="flex flex-col gap-2 rounded-xl border border-primary/40 bg-primary/5 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span>
            {state.emailed
              ? `Invite emailed to ${state.email}. You can also copy the link.`
              : "Invite created, but the email couldn't be sent. Copy the link and send it yourself."}
          </span>
          <CopyInviteLink invitationId={state.inviteId} />
        </div>
      )}
    </div>
  );
}

export function CopyInviteLink({ invitationId }: { invitationId: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(
      `${window.location.origin}/accept-invitation/${invitationId}`,
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Button variant="outline" size="sm" onClick={copy}>
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

export function ResendInvite({ invitationId }: { invitationId: string }) {
  const [state, action, pending] = useActionState<ResendState, FormData>(
    resendInvitationAction,
    undefined,
  );
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="invitationId" value={invitationId} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        <Send />
        {pending ? "Sending…" : "Resend"}
      </Button>
      {state?.error && (
        <span className="text-xs text-destructive">{state.error}</span>
      )}
      {state && !state.error && (
        <span className="text-xs text-muted-foreground">
          {state.emailed ? "Sent" : "Email failed — copy the link"}
        </span>
      )}
    </form>
  );
}
