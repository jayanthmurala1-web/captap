import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { getProjectStatus } from "@/lib/status";

type Status = Awaited<ReturnType<typeof getProjectStatus>>;
type Item = { id: string; key: string; title: string };

/** Deterministic project status (ADR-011) — what needs a person's attention, then progress. */
export function StatusPanel({ s }: { s: Status }) {
  const p = s.progress;
  if (!p.total) return null;

  const attention = [
    {
      title: "Sent back",
      items: s.sentBack,
      detail: (i: Item) => s.sentBack.find((x) => x.id === i.id)?.agent,
    },
    {
      title: "Stale for 24h+",
      items: s.stale,
      detail: (i: Item) => s.stale.find((x) => x.id === i.id)?.agent,
    },
    {
      title: "Blocked",
      items: s.blocked,
      detail: (i: Item) =>
        `waiting on ${s.blocked.find((x) => x.id === i.id)?.blockedBy.join(", ")}`,
    },
  ].filter((g) => g.items.length > 0);

  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div className="rounded-2xl border bg-card p-5">
        <p className="text-4xl font-semibold tabular-nums">{p.percentDone}%</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {p.done} of {p.total} tasks done
        </p>
        <div
          className="mt-4 h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={p.percentDone}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Project progress"
        >
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${p.percentDone}%` }}
          />
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
          <Stat label="To do" value={p.todo} />
          <Stat label="In progress" value={p.inProgress} />
          <Stat label="In review" value={p.inReview} />
        </dl>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
        <h2 className="text-sm font-medium">
          Needs your review{" "}
          <span className="text-muted-foreground">{s.needsReview.length}</span>
        </h2>
        {s.needsReview.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing waiting for approval.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {s.needsReview.map((i) => (
              <TaskLink key={i.id} i={i} detail={i.agent} emphasize />
            ))}
          </ul>
        )}
        {attention.map((g) => (
          <div key={g.title} className="border-t pt-3">
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-warning">
              {g.title}{" "}
              <span className="text-muted-foreground">{g.items.length}</span>
            </h3>
            <ul className="flex flex-col gap-1">
              {g.items.map((i) => (
                <TaskLink key={i.id} i={i} detail={g.detail(i)} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function TaskLink({
  i,
  detail,
  emphasize,
}: {
  i: Item;
  detail?: string | null;
  emphasize?: boolean;
}) {
  return (
    <li>
      <Link
        href={`/tasks/${i.id}`}
        className="group -mx-2 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-accent"
      >
        <span className="font-mono text-xs text-muted-foreground">{i.key}</span>
        <span className="min-w-0 flex-1 truncate">{i.title}</span>
        {detail && (
          <span className="hidden shrink-0 font-mono text-xs text-muted-foreground sm:inline">
            {detail}
          </span>
        )}
        {emphasize && (
          <ArrowRight className="size-3.5 shrink-0 text-primary opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </Link>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted/60 px-2.5 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
