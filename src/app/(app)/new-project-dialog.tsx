"use client";

import { Plus } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createProjectAction, type FormState } from "./actions";

export function NewProjectDialog({ size = "sm" }: { size?: "sm" | "default" }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    createProjectAction,
    undefined,
  );
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size={size}>
          <Plus />
          New project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            One project per client engagement. You&apos;ll add the PRD and tasks
            next.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-name">Name</Label>
            <Input
              id="project-name"
              name="name"
              required
              maxLength={120}
              placeholder="e.g. Acme Checkout"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-desc">
              Description{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Textarea
              id="project-desc"
              name="description"
              maxLength={2000}
              rows={3}
              placeholder="Client, scope, what done looks like"
            />
          </div>
          {state?.error && (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
