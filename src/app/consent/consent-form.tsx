"use client";

import { Check, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { AuthFrame } from "@/components/auth-frame";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

const SCOPE_TEXT: Record<string, string> = {
  openid: "Confirm who you are",
  profile: "See your name",
  email: "See your email address",
  offline_access: "Stay connected until you revoke it",
};

export function ConsentForm({ appName }: { appName: string | null }) {
  const params = useSearchParams();
  const [pending, setPending] = useState<"allow" | "deny" | null>(null);
  const scopes = params.get("scope")?.split(" ").filter(Boolean) ?? [];
  const clientId = params.get("client_id") ?? "";
  const { data: session } = authClient.useSession();

  async function decide(accept: boolean) {
    setPending(accept ? "allow" : "deny");
    const { data } = await authClient.oauth2.consent({ accept });
    const url = (data as { url?: string } | null)?.url;
    if (url) window.location.href = url;
    else setPending(null);
  }

  const name = appName ?? "this app";
  return (
    <AuthFrame
      title={`Connect ${name} to Captap?`}
      subtitle={
        session ? (
          <>
            It will act as{" "}
            <strong className="text-foreground">{session.user.email}</strong>.
          </>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        {!appName && clientId && (
          <p className="text-xs text-muted-foreground">
            Client ID <span className="font-mono">{clientId}</span>
          </p>
        )}
        <section className="rounded-xl border bg-card p-4 text-sm">
          <h2 className="font-medium">It will be able to</h2>
          <ul className="mt-2 flex flex-col gap-1.5">
            {[
              "Read projects, tasks and documents you can access",
              "Claim tasks and submit work with evidence for review",
              "Create and update documents and tasks",
            ].map((t) => (
              <li key={t} className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-success" />
                {t}
              </li>
            ))}
          </ul>
          <h2 className="mt-4 font-medium">It can&apos;t</h2>
          <ul className="mt-2 flex flex-col gap-1.5">
            <li className="flex gap-2">
              <X className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              Approve work. Only a person can, in the app.
            </li>
          </ul>
        </section>

        {scopes.length > 0 && (
          <details className="text-sm text-muted-foreground">
            <summary className="cursor-pointer">
              Requested permissions ({scopes.length})
            </summary>
            <ul className="mt-2 flex flex-col gap-1 pl-4">
              {scopes.map((s) => (
                <li key={s}>
                  {SCOPE_TEXT[s] ?? s}{" "}
                  <span className="font-mono text-xs">({s})</span>
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className="flex gap-3">
          <Button
            size="lg"
            className="flex-1"
            disabled={pending !== null}
            onClick={() => decide(true)}
          >
            {pending === "allow" ? "Connecting…" : "Allow"}
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="flex-1"
            disabled={pending !== null}
            onClick={() => decide(false)}
          >
            {pending === "deny" ? "Cancelling…" : "Deny"}
          </Button>
        </div>
      </div>
    </AuthFrame>
  );
}
