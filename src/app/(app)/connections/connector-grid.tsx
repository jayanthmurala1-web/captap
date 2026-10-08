"use client";

import { Check, Pencil, Plus, RefreshCw } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { listConnections } from "@/lib/connections";
import {
  checkConnectionAction,
  deleteConnectionAction,
  type FormState,
  updateConnectionAction,
} from "./actions";
import { COPY, ConnectionForm } from "./connection-form";
import { CONNECTOR_CATALOG, type ConnectorKind } from "./connector-catalog";

type Connection = Awaited<ReturnType<typeof listConnections>>[number];

const STALE_AFTER_DAYS = 7;

function verifiedLabel(at: Date | null) {
  if (!at) return { text: "Never verified", stale: true };
  const days = Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000);
  return {
    text:
      days < 1
        ? "Verified today"
        : `Verified ${days} day${days === 1 ? "" : "s"} ago`,
    stale: days >= STALE_AFTER_DAYS,
  };
}

export function ConnectorGrid({
  connections,
  slackOAuthReady,
  githubOAuthReady,
  canStore,
}: {
  connections: Connection[];
  slackOAuthReady: boolean;
  githubOAuthReady: boolean;
  canStore: boolean;
}) {
  const [open, setOpen] = useState<ConnectorKind | null>(null);
  const byKind = (kind: ConnectorKind) =>
    connections.filter((c) => c.kind === kind);

  return (
    <>
      <ul className="grid gap-3 sm:grid-cols-2">
        {(Object.keys(CONNECTOR_CATALOG) as ConnectorKind[]).map((kind) => {
          const def = CONNECTOR_CATALOG[kind];
          const mine = byKind(kind);
          const Icon = def.icon;
          return (
            <li key={kind}>
              <button
                type="button"
                onClick={() => setOpen(kind)}
                disabled={!canStore}
                className="flex w-full items-start gap-3 rounded-2xl border bg-card p-4 text-left transition-colors hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span
                  className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${def.iconClassName}`}
                >
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">{def.name}</span>
                    {mine.length > 0 ? (
                      <Check className="size-4 shrink-0 text-success" />
                    ) : (
                      <Plus className="size-4 shrink-0 text-muted-foreground" />
                    )}
                  </span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">
                    {def.description}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    by {def.by}
                    {mine.length > 0 && ` · ${mine.length} connected`}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {!canStore && (
        <p className="text-xs text-muted-foreground">
          Storing connections is switched off: the server has no{" "}
          <code>SECRETS_ENCRYPTION_KEY</code>.
        </p>
      )}

      {(Object.keys(CONNECTOR_CATALOG) as ConnectorKind[]).map((kind) => (
        <ConnectorDialog
          key={kind}
          kind={kind}
          openState={open}
          onOpenChange={(v) => setOpen(v ? kind : null)}
          connections={byKind(kind)}
          oauthReady={
            kind === "slack_webhook"
              ? slackOAuthReady
              : kind === "github_pat"
                ? githubOAuthReady
                : false
          }
        />
      ))}
    </>
  );
}

function ConnectorDialog({
  kind,
  openState,
  onOpenChange,
  connections,
  oauthReady,
}: {
  kind: ConnectorKind;
  openState: ConnectorKind | null;
  onOpenChange: (open: boolean) => void;
  connections: Connection[];
  oauthReady: boolean;
}) {
  const def = CONNECTOR_CATALOG[kind];
  const Icon = def.icon;
  const isOpen = openState === kind;
  const oauthStartPath =
    kind === "slack_webhook"
      ? "/api/connections/slack/start"
      : kind === "github_pat"
        ? "/api/connections/github/start"
        : null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span
              className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${def.iconClassName}`}
            >
              <Icon className="size-5" />
            </span>
            <div>
              <DialogTitle>{def.name}</DialogTitle>
              <p className="text-xs text-muted-foreground">by {def.by}</p>
            </div>
          </div>
          <DialogDescription className="pt-2 text-left">
            {def.description}
          </DialogDescription>
        </DialogHeader>

        {connections.length > 0 && (
          <ul className="flex flex-col gap-2">
            {connections.map((c) => (
              <ConnectionRow key={c.id} connection={c} kind={kind} />
            ))}
          </ul>
        )}

        {oauthStartPath && oauthReady ? (
          <a
            href={oauthStartPath}
            className="inline-flex h-9 items-center justify-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            Connect {def.name}
          </a>
        ) : (
          <>
            {oauthStartPath && (
              <p className="text-xs text-muted-foreground">
                One-click connect isn&apos;t set up on this server yet — paste
                one below instead.
              </p>
            )}
            <ConnectionForm kind={kind} onSaved={() => onOpenChange(false)} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ConnectionRow({
  connection,
  kind,
}: {
  connection: Connection;
  kind: ConnectorKind;
}) {
  const [editing, setEditing] = useState(false);
  const copy = COPY[kind];
  const verified = verifiedLabel(connection.verifiedAt);
  const [checkState, checkAction, checking] = useActionState<
    FormState,
    FormData
  >(checkConnectionAction, undefined);
  const [state, action, pending] = useActionState<FormState, FormData>(
    async (prev, form) => {
      const res = await updateConnectionAction(prev, form);
      if (!res?.error) setEditing(false);
      return res;
    },
    undefined,
  );

  if (editing) {
    return (
      <li className="rounded-lg border bg-muted/40 p-3">
        <form action={action} className="flex flex-col gap-2">
          <input type="hidden" name="id" value={connection.id} />
          {kind === "custom_mcp" && (
            <Input
              name="url"
              type="url"
              defaultValue={connection.url ?? ""}
              placeholder={copy.url ? "Server URL" : undefined}
              className="h-8 text-sm"
            />
          )}
          <Input
            name="secret"
            type="password"
            placeholder={`New ${copy.secret.toLowerCase()} (leave blank to keep current)`}
            className="h-8 text-sm"
          />
          {state?.error && (
            <p className="text-xs text-destructive">{state.error}</p>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending} className="h-7">
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7"
              onClick={() => setEditing(false)}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-2 rounded-lg border bg-muted/40 py-1.5 pr-1.5 pl-3 text-sm">
      <span className="min-w-0 flex-1">
        <span className="block truncate">
          {connection.label}
          <span className="text-muted-foreground">
            {" "}
            ·{" "}
            {connection.url ??
              (connection.secretHint ? `••••${connection.secretHint}` : "")}
          </span>
        </span>
        {checkState?.error ? (
          <span className="block truncate text-xs text-destructive">
            Check failed: {checkState.error}
          </span>
        ) : (
          <span
            className={`block text-xs ${verified.stale ? "text-warning" : "text-muted-foreground"}`}
          >
            {verified.text}
          </span>
        )}
      </span>
      {kind !== "slack_webhook" && (
        <form action={checkAction}>
          <input type="hidden" name="id" value={connection.id} />
          <button
            type="submit"
            disabled={checking}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            aria-label="Check connection now"
            title="Check it still works"
          >
            <RefreshCw
              className={`size-3.5 ${checking ? "animate-spin" : ""}`}
            />
          </button>
        </form>
      )}
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Edit connection"
      >
        <Pencil className="size-3.5" />
      </button>
      <form action={deleteConnectionAction}>
        <input type="hidden" name="id" value={connection.id} />
        <button
          type="submit"
          className="rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
        >
          Remove
        </button>
      </form>
    </li>
  );
}
