"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { createOrgAction, type FormState } from "./actions";

export function CreateOrg({ email }: { email: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    createOrgAction,
    undefined,
  );
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <p className="font-wordmark text-3xl text-primary">Captap</p>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">
          Set up your agency&apos;s workspace
        </h1>
        <p className="mt-2 text-muted-foreground">
          Your team, your client projects, and every approval in one place.
          You&apos;ll add the first project next.
        </p>
        <form action={action} className="mt-8 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="org-name">Agency name</Label>
            <Input
              id="org-name"
              name="name"
              required
              maxLength={120}
              placeholder="e.g. Northwind Studio"
              className="h-10"
            />
            <p className="text-xs text-muted-foreground">
              Clients see this name when you send them something to approve.
            </p>
          </div>
          {state?.error && (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          )}
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? "Creating…" : "Create workspace"}
          </Button>
        </form>
        <p className="mt-8 text-sm text-muted-foreground">
          Signed in as {email} ·{" "}
          <button
            type="button"
            className="underline underline-offset-4 hover:text-foreground"
            onClick={() =>
              authClient.signOut({
                fetchOptions: {
                  onSuccess: () => {
                    window.location.href = "/sign-in";
                  },
                },
              })
            }
          >
            Sign out
          </button>
        </p>
      </div>
    </main>
  );
}
