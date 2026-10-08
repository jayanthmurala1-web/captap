"use client";

import { Check, Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WebhookEventType } from "@/db/schema";
import type { listWebhookSubscriptions } from "@/lib/webhooks";
import {
  createWebhookAction,
  deleteWebhookAction,
  testWebhookAction,
  updateWebhookAction,
} from "../actions";

type Hook = Awaited<ReturnType<typeof listWebhookSubscriptions>>[number];

const EVENTS: { id: WebhookEventType; label: string }[] = [
  { id: "task.submitted", label: "Work submitted for review" },
  { id: "task.approved", label: "Work approved" },
  { id: "task.rejected", label: "Work sent back" },
  { id: "task.created", label: "Task created" },
  { id: "task.claimed", label: "Task claimed by an agent" },
  { id: "doc.published", label: "Document published" },
  { id: "pr.synthesized", label: "Pull request prepared" },
];

export function WebhooksSection({
  projectId,
  hooks,
}: {
  projectId: string;
  hooks: Hook[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);

  const create = (form: FormData) =>
    start(async () => {
      setError(null);
      const fields = readHookForm(form);
      if (!fields.events.length) return setError("Pick at least one event");
      const res = await createWebhookAction(projectId, fields);
      if (!res.ok) return setError(res.error ?? "Couldn't add the endpoint");
      setNewSecret((res.subscription as { secret: string }).secret);
      setAdding(false);
      router.refresh();
    });
  const test = (id: string) =>
    start(async () => {
      const res = await testWebhookAction(id);
      setResults((r) => ({
        ...r,
        [id]: res.ok
          ? "Test delivered"
          : (res.message ?? res.error ?? "Test failed"),
      }));
    });
  const update = (
    id: string,
    patch: Parameters<typeof updateWebhookAction>[2],
    done?: () => void,
  ) =>
    start(async () => {
      setError(null);
      const res = await updateWebhookAction(projectId, id, patch);
      if (!res.ok) return setError(res.error ?? "Couldn't save the change");
      done?.();
      router.refresh();
    });
  const edit = (id: string, form: FormData) => {
    const fields = readHookForm(form);
    if (!fields.events.length) return setError("Pick at least one event");
    update(id, fields, () => setEditing(null));
  };
  const remove = (id: string) => {
    setRemoved((r) => new Set(r).add(id)); // hide now; the refresh confirms
    start(async () => {
      const res = await deleteWebhookAction(projectId, id);
      if (!res.ok) {
        setRemoved((r) => {
          const next = new Set(r);
          next.delete(id);
          return next;
        });
        setError(res.error ?? "Couldn't remove it");
      }
      router.refresh();
    });
  };
  const visible = hooks.filter((h) => !removed.has(h.id));

  return (
    <div className="flex flex-col gap-4">
      {newSecret && (
        <SecretOnce secret={newSecret} onDone={() => setNewSecret(null)} />
      )}

      {visible.length > 0 && (
        <ul className="divide-y rounded-2xl border bg-card">
          {visible.map((h) => (
            <li key={h.id} className="flex flex-col gap-2 px-4 py-3">
              {editing === h.id ? (
                <HookForm
                  initial={h}
                  submitLabel="Save changes"
                  pendingLabel="Saving…"
                  pending={pending}
                  error={error}
                  onSubmit={(form) => edit(h.id, form)}
                  onCancel={() => {
                    setEditing(null);
                    setError(null);
                  }}
                />
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 font-medium">
                        {h.name}
                        {!h.projectId && (
                          <Badge variant="secondary">Workspace-wide</Badge>
                        )}
                        {!h.active && <Badge variant="warning">Paused</Badge>}
                      </span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        {h.url}
                      </span>
                    </span>
                    {h.projectId && (
                      <span className="flex gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => test(h.id)}
                          disabled={pending}
                        >
                          Send test
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setError(null);
                            setEditing(h.id);
                          }}
                          disabled={pending}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => update(h.id, { active: !h.active })}
                          disabled={pending}
                        >
                          {h.active ? "Pause" : "Resume"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => remove(h.id)}
                          disabled={pending}
                        >
                          Remove
                        </Button>
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {h.events.map((e) => (
                      <Badge
                        key={e}
                        variant="outline"
                        className="font-mono text-[11px]"
                      >
                        {e}
                      </Badge>
                    ))}
                  </div>
                  {results[h.id] && (
                    <p className="text-sm text-muted-foreground">
                      {results[h.id]}
                    </p>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="rounded-2xl border bg-card p-4">
          <HookForm
            submitLabel="Add endpoint"
            pendingLabel="Adding…"
            pending={pending}
            error={error}
            onSubmit={create}
            onCancel={() => setAdding(false)}
          />
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => setAdding(true)}
        >
          Add endpoint
        </Button>
      )}
      {!adding && error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function readHookForm(form: FormData) {
  return {
    name: String(form.get("name")),
    url: String(form.get("url")),
    events: EVENTS.map((e) => e.id).filter((id) => form.get(id)),
  };
}

function HookForm({
  initial,
  submitLabel,
  pendingLabel,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: { name: string; url: string; events: WebhookEventType[] };
  submitLabel: string;
  pendingLabel: string;
  pending: boolean;
  error: string | null;
  onSubmit: (form: FormData) => void;
  onCancel: () => void;
}) {
  const uid = initial ? "edit" : "new";
  return (
    <form action={onSubmit} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`hook-name-${uid}`}>Name</Label>
          <Input
            id={`hook-name-${uid}`}
            name="name"
            required
            maxLength={80}
            defaultValue={initial?.name}
            placeholder="e.g. Team Slack"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`hook-url-${uid}`}>URL</Label>
          <Input
            id={`hook-url-${uid}`}
            name="url"
            type="url"
            required
            defaultValue={initial?.url}
            placeholder="https://"
          />
        </div>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        Slack and Discord incoming-webhook URLs get formatted messages; any
        other URL gets signed JSON (HMAC-SHA256).
        {initial &&
          " The signing secret can't be changed; remove and re-add to rotate it."}
      </p>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Send when</legend>
        {EVENTS.map((e) => (
          <label key={e.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name={e.id}
              defaultChecked={
                initial
                  ? initial.events.includes(e.id)
                  : e.id === "task.submitted" || e.id === "task.approved"
              }
              className="size-4 accent-primary"
            />
            {e.label}
          </label>
        ))}
      </fieldset>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function SecretOnce({
  secret,
  onDone,
}: {
  secret: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm">
      <p className="font-medium">
        Signing secret. Copy it now; it won&apos;t be shown again.
      </p>
      <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5">
        <code className="min-w-0 flex-1 truncate font-mono text-xs">
          {secret}
        </code>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Copy secret"
          onClick={async () => {
            await navigator.clipboard.writeText(secret);
            setCopied(true);
          }}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
      <Button variant="ghost" size="sm" className="self-start" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}
