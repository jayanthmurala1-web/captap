"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthFrame } from "@/components/auth-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

// Also the OAuth login page: the client plugin forwards the signed query so the MCP flow resumes.
function SignIn() {
  const params = useSearchParams();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [pending, setPending] = useState(false);
  const connectingAgent = params.has("client_id");
  // Only same-site paths — never an absolute URL (open redirect).
  const nextParam = params.get("next");
  const next =
    nextParam?.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(undefined);
    setNotice(undefined);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    try {
      const { data, error } =
        mode === "in"
          ? await authClient.signIn.email({ email, password })
          : await authClient.signUp.email({
              email,
              password,
              name: String(form.get("name")),
              callbackURL: next, // where the confirmation link lands, already signed in
            });
      setPending(false);
      if (error) {
        if (error.code === "EMAIL_NOT_VERIFIED")
          return setNotice(
            `Confirm your email first. We just sent a new link to ${email}.`,
          );
        return setError(error.message ?? "Authentication failed");
      }
      // Verification required on this server: the account exists but has no session yet.
      if (mode === "up" && data && "token" in data && !data.token)
        return setNotice(
          `Check your inbox. We sent a confirmation link to ${email}; click it to finish signing up.`,
        );
      // An OAuth flow in progress returns its own redirect; otherwise go to the app.
      if (!(data && "redirect" in data && data.redirect)) {
        window.location.href = next;
      }
    } catch (err) {
      setPending(false);
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  const switchMode = (m: "in" | "up") => {
    setMode(m);
    setError(undefined);
    setNotice(undefined);
  };

  return (
    <AuthFrame
      title={mode === "in" ? "Sign in" : "Create your account"}
      subtitle={
        connectingAgent
          ? "Sign in to connect your coding agent to Captap."
          : "Client-approved requirements, checked on every task your agents ship."
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {mode === "up" && (
          <Field id="user-name" label="Name">
            <Input
              id="user-name"
              name="name"
              required
              autoComplete="name"
              className="h-10"
            />
          </Field>
        )}
        <Field id="user-email" label="Work email">
          <Input
            id="user-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@agency.com"
            className="h-10"
          />
        </Field>
        <Field id="user-password" label="Password">
          <Input
            id="user-password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === "in" ? "current-password" : "new-password"}
            placeholder={mode === "up" ? "At least 8 characters" : undefined}
            className="h-10"
          />
        </Field>
        {notice && (
          <p
            role="status"
            className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm"
          >
            {notice}
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={pending} className="mt-1">
          {pending
            ? mode === "in"
              ? "Signing in…"
              : "Creating account…"
            : mode === "in"
              ? "Sign in"
              : "Create account"}
        </Button>
      </form>

      <p className="mt-6 text-sm text-muted-foreground">
        {mode === "in" ? (
          <>
            New to Captap?{" "}
            <button
              type="button"
              onClick={() => switchMode("up")}
              className="font-medium text-foreground underline underline-offset-4"
            >
              Create an account
            </button>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <button
              type="button"
              onClick={() => switchMode("in")}
              className="font-medium text-foreground underline underline-offset-4"
            >
              Sign in
            </button>
          </>
        )}
      </p>
      {!connectingAgent && (
        <p className="mt-10 border-t pt-4 text-xs text-muted-foreground">
          Connecting Claude Code, Cursor or another MCP agent? Add the Captap
          MCP server in your agent and it will send you here to approve it.
        </p>
      )}
    </AuthFrame>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}
