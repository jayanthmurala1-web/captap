"use client";

import { Bot, CircleAlert, Lock, User } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { OptionSelect } from "@/components/ui/option-select";
import { ROLE_LABEL } from "@/lib/task-labels";
import type { listTasks } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { moveTaskStatusAction } from "./actions";

export type TaskItem = Awaited<ReturnType<typeof listTasks>>[number];
type PrdItem = { id: string; title: string };
type Status = TaskItem["status"];

const COLUMNS: { id: Status; label: string; hint?: string }[] = [
  { id: "todo", label: "To do" },
  { id: "in_progress", label: "In progress" },
  { id: "in_review", label: "In review", hint: "Agents submit evidence here" },
  { id: "done", label: "Done", hint: "Approved on the task page" },
];
// ADR-004: the board only moves work between these two; review and Done go through evidence + approval.
const DRAGGABLE: Status[] = ["todo", "in_progress"];

export function TaskBoard({
  tasks: initialTasks,
  projectId,
  prds,
}: {
  tasks: TaskItem[];
  projectId: string;
  prds: PrdItem[];
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [live, setLive] = useState(false);
  const [prdId, setPrdId] = useState("all");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<Status | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [, start] = useTransition();

  useEffect(() => setTasks(initialTasks), [initialTasks]);

  // Live updates: the server polls every few seconds and pushes changes (SSE).
  useEffect(() => {
    const es = new EventSource(
      `/api/projects/${encodeURIComponent(projectId)}/tasks/stream`,
    );
    const onTasks = (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      if (Array.isArray(data.tasks)) setTasks(data.tasks);
      setLive(true);
    };
    es.addEventListener("init", onTasks);
    es.addEventListener("update", onTasks);
    es.onerror = () => setLive(false);
    return () => es.close();
  }, [projectId]);

  const shown = useMemo(
    () =>
      tasks.filter(
        (t) =>
          prdId === "all" ||
          (prdId === "none" ? !t.prdDocumentId : t.prdDocumentId === prdId),
      ),
    [tasks, prdId],
  );

  const move = (taskId: string, to: Status) => {
    const t = tasks.find((x) => x.id === taskId);
    if (!t || t.status === to) return;
    if (!DRAGGABLE.includes(t.status) || !DRAGGABLE.includes(to)) {
      setNotice(
        to === "done" || t.status === "in_review"
          ? "Approve or send back from the task page, where the evidence is."
          : "Tasks reach review when an agent submits evidence.",
      );
      return;
    }
    setNotice(null);
    const before = tasks;
    setTasks((prev) =>
      prev.map((x) => (x.id === taskId ? { ...x, status: to } : x)),
    );
    start(async () => {
      const res = await moveTaskStatusAction(taskId, projectId, to);
      if (!res.ok) {
        setTasks(before);
        setNotice(res.error ?? "Couldn't move the task");
      }
    });
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {prds.length > 0 && (
          <OptionSelect
            label="PRD"
            value={prdId}
            onValueChange={setPrdId}
            className="w-56 bg-card"
            options={[
              { value: "all", label: "All PRDs" },
              ...prds.map((p) => ({ value: p.id, label: p.title })),
              { value: "none", label: "Not tied to a PRD" },
            ]}
          />
        )}
        <span
          className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground"
          title={live ? "Updates appear as agents work" : "Reconnecting…"}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              live ? "bg-success" : "bg-muted-foreground/50",
            )}
          />
          {live ? "Live" : "Connecting"}
        </span>
      </div>

      {notice && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-sm"
        >
          <CircleAlert className="size-4 shrink-0 text-warning" />
          {notice}
        </p>
      )}

      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:px-0 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const items = shown.filter((t) => t.status === col.id);
          return (
            // Drag is a mouse shortcut; keyboard users move work from the task page.
            <section
              key={col.id}
              aria-label={col.label}
              onDragOver={(e) => {
                e.preventDefault();
                setOverCol(col.id);
              }}
              onDragLeave={() => setOverCol(null)}
              onDrop={(e) => {
                e.preventDefault();
                setOverCol(null);
                if (dragId) move(dragId, col.id);
                setDragId(null);
              }}
              className={cn(
                "flex w-[82vw] shrink-0 snap-start flex-col gap-2 rounded-2xl border bg-muted/30 p-2.5 sm:w-auto",
                overCol === col.id &&
                  (DRAGGABLE.includes(col.id)
                    ? "border-primary/60 bg-primary/5"
                    : "border-warning/50"),
              )}
            >
              <div className="flex items-baseline justify-between px-1.5 pt-1">
                <h3 className="text-sm font-medium">
                  {col.label}{" "}
                  <span className="text-muted-foreground">{items.length}</span>
                </h3>
                {col.hint && (
                  <span className="text-[11px] text-muted-foreground">
                    {col.hint}
                  </span>
                )}
              </div>
              <ul className="flex min-h-24 flex-col gap-2">
                {items.map((t) => (
                  <TaskCard
                    key={t.id}
                    t={t}
                    draggable={DRAGGABLE.includes(t.status)}
                    onDragStart={() => setDragId(t.id)}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </section>
  );
}

function TaskCard({
  t,
  draggable,
  onDragStart,
}: {
  t: TaskItem;
  draggable: boolean;
  onDragStart: () => void;
}) {
  const blocked = t.status === "todo" && t.blockedBy.length > 0;
  return (
    <li
      draggable={draggable}
      onDragStart={onDragStart}
      className={cn(
        "rounded-xl border bg-card transition-colors hover:border-primary/40",
        draggable && "cursor-grab active:cursor-grabbing",
      )}
    >
      <Link href={`/tasks/${t.id}`} className="flex flex-col gap-2 p-3">
        <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{t.key}</span>
          <span>{ROLE_LABEL[t.role] ?? t.role}</span>
        </span>
        <span className="text-sm font-medium leading-snug">{t.title}</span>
        {(t.claimedAgent ||
          t.assignee ||
          blocked ||
          t.reviewNote ||
          t.requirementKeys.length > 0) && (
          <span className="flex flex-wrap items-center gap-1.5">
            {t.requirementKeys.map((k) => (
              <Badge key={k} variant="secondary" className="font-mono">
                {k}
              </Badge>
            ))}
            {blocked && (
              <Badge
                variant="secondary"
                title={`Waiting on ${t.blockedBy.join(", ")}`}
              >
                <Lock />
                {t.blockedBy.join(", ")}
              </Badge>
            )}
            {t.reviewNote && t.status === "in_progress" && (
              <Badge variant="warning">Sent back</Badge>
            )}
            {t.claimedAgent ? (
              <Badge variant="outline" className="font-mono">
                <Bot />
                {t.claimedAgent}
              </Badge>
            ) : t.assignee ? (
              <Badge variant="outline">
                <User />
                {t.assignee}
              </Badge>
            ) : null}
          </span>
        )}
      </Link>
    </li>
  );
}
