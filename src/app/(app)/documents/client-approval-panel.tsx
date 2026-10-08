"use client";

import { Check, Copy, Link2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type {
  getApprovalStatus,
  listDocumentShares,
} from "@/lib/document-share";
import { formatDateShort } from "@/lib/utils";
import { createShareLinkAction, revokeShareLinkAction } from "./actions";

type Status = Awaited<ReturnType<typeof getApprovalStatus>>;
type Share = Awaited<ReturnType<typeof listDocumentShares>>[number];

export function ClientApprovalPanel({
  documentId,
  status,
  shares,
}: {
  documentId: string;
  status: Status;
  shares: Share[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const latest = status.latest;

  const create = () =>
    start(async () => {
      setError(null);
      const res = await createShareLinkAction(documentId);
      if (!res.ok) setError(res.error ?? "Couldn't create a link");
      router.refresh();
    });
  const revoke = (id: string) =>
    start(async () => {
      setError(null);
      const res = await revokeShareLinkAction(id, documentId);
      if (!res.ok) setError(res.error ?? "Couldn't revoke the link");
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-4 text-sm">
      {!latest ? (
        <p className="text-muted-foreground">
          {shares.length
            ? "Shared, waiting for the client's decision."
            : "Send the client a link. They can read it and approve or request changes, with no account."}
        </p>
      ) : (
        <div>
          <p
            className={
              latest.decision === "approved" && !status.stale
                ? "font-medium text-success"
                : "font-medium text-warning"
            }
          >
            {latest.decision === "approved"
              ? `Approved v${latest.version}`
              : `Changes requested on v${latest.version}`}
          </p>
          <p className="text-muted-foreground">
            {latest.approverName} · {formatDateShort(latest.createdAt)}
          </p>
          {latest.note && (
            <blockquote className="mt-2 border-l-2 border-warning/60 pl-3">
              {latest.note}
            </blockquote>
          )}
          {status.stale && latest.decision === "approved" && (
            <p className="mt-2 text-warning">
              The document has changed since. Share again before relying on it.
            </p>
          )}
        </div>
      )}

      {shares.length > 0 && (
        <ul className="flex flex-col gap-2">
          {shares.map((s) => (
            <ShareRow
              key={s.id}
              share={s}
              onRevoke={() => revoke(s.id)}
              disabled={pending}
            />
          ))}
        </ul>
      )}

      <Button
        variant={shares.length ? "outline" : "default"}
        size="sm"
        className="self-start"
        onClick={create}
        disabled={pending}
      >
        {shares.length ? <Plus /> : <Link2 />}
        {shares.length ? "New link" : "Create share link"}
      </Button>
      {error && <p className="text-destructive">{error}</p>}
    </div>
  );
}

function ShareRow({
  share,
  onRevoke,
  disabled,
}: {
  share: Share;
  onRevoke: () => void;
  disabled: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(
      `${window.location.origin}/approve/${share.token}`,
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <li className="flex items-center gap-2 rounded-lg border bg-muted/40 py-1.5 pr-1.5 pl-3">
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        Link from {formatDateShort(share.createdAt)}
      </span>
      <Button variant="ghost" size="sm" onClick={copy} aria-label="Copy link">
        {copied ? <Check /> : <Copy />}
        {copied ? "Copied" : "Copy"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={onRevoke}
        disabled={disabled}
      >
        Revoke
      </Button>
    </li>
  );
}
