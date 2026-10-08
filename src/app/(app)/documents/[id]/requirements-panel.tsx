import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { listRequirements, RequirementState } from "@/lib/requirements";
import { NumberRequirements } from "./number-requirements";

type Data = Awaited<ReturnType<typeof listRequirements>>;

const STATE: Record<
  RequirementState,
  { label: string; variant: "secondary" | "outline" | "warning" | "success" }
> = {
  no_task: { label: "No work yet", variant: "warning" },
  not_started: { label: "Not started", variant: "secondary" },
  in_progress: { label: "In progress", variant: "secondary" },
  in_review: { label: "In review", variant: "outline" },
  done: { label: "Done", variant: "success" },
};

/** Per-requirement traceability for a PRD: what has work, what's in review, what's done and approved. */
export function RequirementsPanel({
  documentId,
  data,
  canEdit,
}: {
  documentId: string;
  data: Data;
  canEdit: boolean;
}) {
  const { requirements, counts, unnumbered } = data;
  return (
    <section className="rounded-2xl border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">Requirements</h2>
      {counts.total > 0 && (
        <p className="mb-3 text-sm text-muted-foreground">
          {counts.withWork} of {counts.total} have work · {counts.done} done and
          approved
        </p>
      )}
      {unnumbered > 0 && (
        <div className="mb-3 rounded-xl border border-warning/40 bg-warning/5 p-3 text-sm">
          <p>
            {unnumbered} acceptance{" "}
            {unnumbered === 1 ? "criterion has" : "criteria have"} no number
            yet, so tasks can&apos;t link to {unnumbered === 1 ? "it" : "them"}.
          </p>
          {canEdit ? (
            <>
              <p className="mt-1 text-xs text-muted-foreground">
                This saves a new version (R-1, R-2… added to the text). If the
                client already approved this PRD, they&apos;ll see it as
                changed.
              </p>
              <NumberRequirements documentId={documentId} />
            </>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              Someone who can manage documents needs to number them.
            </p>
          )}
        </div>
      )}
      {requirements.length === 0 && unnumbered === 0 ? (
        <p className="text-sm text-muted-foreground">
          No acceptance criteria yet. Each bullet under Acceptance Criteria
          becomes a requirement tasks can trace to.
        </p>
      ) : (
        <ul className="flex flex-col divide-y">
          {requirements.map((r) => (
            <li key={r.id} className="flex flex-col gap-1.5 py-2.5 first:pt-0">
              <span className="flex items-start justify-between gap-2 text-sm">
                <span
                  className={
                    r.removed ? "text-muted-foreground line-through" : ""
                  }
                >
                  <span className="font-mono text-xs text-muted-foreground">
                    {r.key}
                  </span>{" "}
                  {r.text}
                </span>
                {r.removed ? (
                  <Badge variant="secondary">Removed</Badge>
                ) : (
                  <Badge variant={STATE[r.state].variant}>
                    {STATE[r.state].label}
                  </Badge>
                )}
              </span>
              {r.tasks.length > 0 && (
                <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  {r.tasks.map((t) => (
                    <Link
                      key={t.id}
                      href={`/tasks/${t.id}`}
                      className="text-primary hover:underline"
                    >
                      <span className="font-mono">{t.key}</span> {t.title}
                    </Link>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
