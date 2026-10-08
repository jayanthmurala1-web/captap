"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
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
import {
  deleteProjectAction,
  type FormState,
  updateProjectAction,
} from "./actions";

export function RenameProjectForm({
  projectId,
  name,
  description,
}: {
  projectId: string;
  name: string;
  description: string | null;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    updateProjectAction,
    undefined,
  );
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="project-name">Name</Label>
        <Input
          id="project-name"
          name="name"
          defaultValue={name}
          required
          maxLength={120}
          className="max-w-md"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="project-description">Description</Label>
        <Textarea
          id="project-description"
          name="description"
          defaultValue={description ?? ""}
          rows={2}
          maxLength={2000}
          className="max-w-md"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {state?.error && (
          <span className="text-sm text-destructive">{state.error}</span>
        )}
        {state?.ok && <span className="text-sm text-success">Saved</span>}
      </div>
    </form>
  );
}

export function DeleteProjectDialog({
  projectId,
  name,
}: {
  projectId: string;
  name: string;
}) {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const canDelete = confirmText === name;

  const remove = async () => {
    setPending(true);
    setError(null);
    const res = await deleteProjectAction(projectId);
    setPending(false);
    if (res?.error) {
      setError(res.error);
      return;
    }
    router.push("/");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setConfirmText("");
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="text-destructive hover:text-destructive"
        >
          <Trash2 />
          Delete project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{name}”?</DialogTitle>
          <DialogDescription>
            This permanently deletes every task, document, PRD, requirement,
            agent, worktree and webhook in this project, including any
            client-approved documents and their recorded decisions. It
            can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm-project-name">
            Type <span className="font-mono font-semibold">{name}</span> to
            confirm
          </Label>
          <Input
            id="confirm-project-name"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoComplete="off"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            variant="destructive"
            onClick={remove}
            disabled={pending || !canDelete}
          >
            {pending ? "Deleting…" : "Delete project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
