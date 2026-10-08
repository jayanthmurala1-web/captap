"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
import { deleteDocumentAction } from "../actions";

export function DeleteDocument({
  id,
  title,
  approvalCount,
  linkedTaskCount,
}: {
  id: string;
  title: string;
  /** Client decisions that would be destroyed — this document was shared and decided on. */
  approvalCount: number;
  /** Tasks that would lose their link to this document (prdDocumentId -> null, requirements cascade). */
  linkedTaskCount: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const remove = () =>
    start(async () => {
      const res = await deleteDocumentAction(id);
      if (!res.ok || !res.projectId) {
        setError(res.error ?? "Couldn't delete");
        return;
      }
      router.push(`/projects/${res.projectId}/documents`);
    });

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          <Trash2 />
          Delete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{title}”?</DialogTitle>
          <DialogDescription>
            This deletes every version and share link. It can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        {(approvalCount > 0 || linkedTaskCount > 0) && (
          <div className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-warning">
            {approvalCount > 0 && (
              <p>
                {approvalCount === 1
                  ? "Also destroys 1 recorded client decision on this document."
                  : `Also destroys ${approvalCount} recorded client decisions on this document.`}
              </p>
            )}
            {linkedTaskCount > 0 && (
              <p>
                {linkedTaskCount === 1
                  ? "1 task is linked to this document and will lose that link."
                  : `${linkedTaskCount} tasks are linked to this document and will lose that link.`}
              </p>
            )}
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button variant="destructive" onClick={remove} disabled={pending}>
            {pending ? "Deleting…" : "Delete document"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
