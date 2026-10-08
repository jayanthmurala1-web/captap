"use client";

import { Trash2 } from "lucide-react";
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
import { deleteTaskAction } from "../actions";

export function DeleteTask({
  taskId,
  projectId,
  title,
  busy,
}: {
  taskId: string;
  projectId: string;
  title: string;
  /** In progress or in review: the server refuses, so say so up front instead of failing on click. */
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(deleteTaskAction, undefined);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 />
          Delete task
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{title}”?</DialogTitle>
          <DialogDescription>
            {busy
              ? "Someone is working on this or it's waiting on review. Release it or decide it first, then you can delete it."
              : "This removes the task, its history and its links. Anything that was waiting on it becomes unblocked. It can't be undone."}
          </DialogDescription>
        </DialogHeader>
        {state?.error && (
          <p className="text-sm text-destructive">{state.error}</p>
        )}
        <form action={action}>
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="projectId" value={projectId} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              variant="destructive"
              disabled={pending || busy}
            >
              {pending ? "Deleting…" : "Delete task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
