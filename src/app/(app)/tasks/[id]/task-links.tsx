"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import type { PrdOption } from "@/lib/requirements";
import { type FormState, updateTaskLinksAction } from "../actions";
import { RequirementPicker } from "../requirement-picker";

/** Edit which PRD a task is built under and which of its requirements it delivers. */
export function TaskLinksEditor({
  taskId,
  prds,
  prdId,
  keys,
}: {
  taskId: string;
  prds: PrdOption[];
  prdId: string | null;
  keys: string[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<FormState, FormData>(
    async (prev, form) => {
      const res = await updateTaskLinksAction(prev, form);
      if (res?.ok) setOpen(false);
      return res;
    },
    undefined,
  );
  if (!open)
    return (
      <Button
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={() => setOpen(true)}
      >
        Change
      </Button>
    );
  return (
    <form action={action} className="mt-3 flex flex-col gap-3">
      <input type="hidden" name="taskId" value={taskId} />
      <RequirementPicker
        prds={prds}
        defaultPrd={prdId}
        defaultKeys={keys}
        idPrefix="task-links"
      />
      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
