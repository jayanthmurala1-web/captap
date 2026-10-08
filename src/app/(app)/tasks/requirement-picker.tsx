"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { OptionSelect } from "@/components/ui/option-select";
import type { PrdOption } from "@/lib/requirements";

/** Picks the PRD a task is built under and the requirements it delivers. Submits `prdDocumentId` + `requirementKey`s. */
export function RequirementPicker({
  prds,
  defaultPrd,
  defaultKeys = [],
  idPrefix = "req",
}: {
  prds: PrdOption[];
  defaultPrd?: string | null;
  defaultKeys?: string[];
  idPrefix?: string;
}) {
  const [prdId, setPrdId] = useState(defaultPrd ?? "none");
  const [keys, setKeys] = useState<string[]>(defaultKeys);
  const prd = prds.find((p) => p.id === prdId);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-prd`}>Built under (PRD)</Label>
        <OptionSelect
          id={`${idPrefix}-prd`}
          name="prdDocumentId"
          value={prdId}
          onValueChange={(v) => {
            setPrdId(v);
            setKeys([]);
          }}
          options={[
            { value: "none", label: "Not tied to a PRD" },
            ...prds.map((p) => ({ value: p.id, label: p.title })),
          ]}
        />
        {prds.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Add a PRD in Documents to trace work to what the client approved.
          </p>
        )}
      </div>
      {prd &&
        (prd.requirements.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            This PRD has no numbered requirements yet. Open it and choose
            &ldquo;Number requirements&rdquo;.
          </p>
        ) : (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium">
              Requirements this delivers
            </legend>
            {prd.requirements.map((r) => (
              <label key={r.key} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="requirementKey"
                  value={r.key}
                  className="mt-1 accent-primary"
                  checked={keys.includes(r.key)}
                  onChange={(e) =>
                    setKeys(
                      e.target.checked
                        ? [...keys, r.key]
                        : keys.filter((k) => k !== r.key),
                    )
                  }
                />
                <span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {r.key}
                  </span>{" "}
                  {r.text}
                </span>
              </label>
            ))}
          </fieldset>
        ))}
    </div>
  );
}
