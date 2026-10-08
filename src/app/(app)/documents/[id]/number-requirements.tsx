"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { numberRequirementsAction } from "../actions";

export function NumberRequirements({ documentId }: { documentId: string }) {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <>
      <Button
        size="sm"
        className="mt-2"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await numberRequirementsAction(documentId);
            setError(r?.error);
          })
        }
      >
        {pending ? "Numbering…" : "Number requirements"}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
