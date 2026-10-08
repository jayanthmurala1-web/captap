"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type ConsultSetup,
  consultSetupAction,
  ownKeyModelsAction,
} from "@/app/(app)/consult-actions";
import {
  type AssistantTurn,
  applyConsultEvent,
  emptyTurn,
  parseSseChunk,
} from "@/lib/ai/consult-events";

export type Turn =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; turn: AssistantTurn };

export type Setup = Extract<ConsultSetup, { ok: true }>;
type OwnModels = Awaited<ReturnType<typeof ownKeyModelsAction>>;

const LAST_AGENT = "consult:last-agent";
const readStored = () => {
  try {
    return localStorage.getItem(LAST_AGENT);
  } catch {
    return null;
  }
};

/** Everything a chat surface needs (setup, agent/model pickers, send, streaming turns) — the
 * compact widget and the full-page hero both consume this instead of duplicating it. */
export function useConsult({
  projectId,
  taskId,
  active,
}: {
  projectId?: string;
  taskId?: string;
  /** Only fetch setup while the surface is actually visible (the drawer's old behavior). */
  active: boolean;
}) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [agent, setAgent] = useState<string | null>(null);
  const [modelChoice, setModelChoice] = useState("default");
  const [ownModels, setOwnModels] = useState<OwnModels | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);

  const scopeKey = `${projectId ?? ""}|${taskId ?? ""}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scopeKey stands for projectId + taskId
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    consultSetupAction({ projectId, taskId }).then((r) => {
      if (cancelled) return;
      if (!r.ok) {
        setSetupError(r.error);
        return;
      }
      setSetupError(null);
      setSetup(r);
      const names = r.agents.map((a) => a.name);
      setAgent((cur) => {
        const remembered = readStored();
        return (
          (cur && names.includes(cur) ? cur : null) ??
          (r.defaultAgent && names.includes(r.defaultAgent)
            ? r.defaultAgent
            : null) ??
          (remembered && names.includes(remembered) ? remembered : null)
        );
      });
    });
    return () => {
      cancelled = true;
    };
  }, [active, scopeKey]);

  useEffect(() => {
    if (active && setup && ownModels === null)
      ownKeyModelsAction().then(setOwnModels);
  }, [active, setup, ownModels]);

  const updateLast = (fn: (t: AssistantTurn) => AssistantTurn) =>
    setTurns((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role !== "assistant") return prev;
      return [...prev.slice(0, -1), { ...last, turn: fn(last.turn) }];
    });

  const pickAgent = useCallback((name: string) => {
    setAgent(name);
    setTurns([]);
    try {
      localStorage.setItem(LAST_AGENT, name);
    } catch {
      /* private mode: remembering is a convenience only */
    }
  }, []);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy || !agent) return;
    const history = [
      ...turns.map((t) =>
        t.role === "user"
          ? { role: "user", content: t.text }
          : { role: "assistant", content: t.turn.text },
      ),
      { role: "user", content },
    ];
    setTurns((p) => [
      ...p,
      { id: crypto.randomUUID(), role: "user", text: content },
      { id: crypto.randomUUID(), role: "assistant", turn: emptyTurn() },
    ]);
    setBusy(true);
    const [provider, model] =
      modelChoice === "default"
        ? [undefined, undefined]
        : modelChoice.split("|");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          agentName: agent,
          projectId,
          taskId,
          provider,
          model,
        }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let rest = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const parsed = parseSseChunk(
          rest,
          decoder.decode(value, { stream: true }),
        );
        rest = parsed.rest;
        for (const e of parsed.events)
          updateLast((t) => applyConsultEvent(t, e));
      }
    } catch (e) {
      updateLast((t) => ({
        ...t,
        error: e instanceof Error ? e.message : "Something went wrong",
      }));
    } finally {
      updateLast((t) => ({ ...t, done: true }));
      setBusy(false);
    }
  }

  const current = setup?.agents.find((a) => a.name === agent);
  const answered = [...turns]
    .reverse()
    .find(
      (t): t is Extract<Turn, { role: "assistant" }> =>
        t.role === "assistant" && !!t.turn.model,
    )?.turn;

  const modelOptions = [
    {
      value: "default",
      label: setup
        ? `Default · ${setup.access.defaultModel.split("/").pop()}`
        : "Default",
    },
    ...(setup?.access.platformModels
      .filter((m) => m.includedInPlan)
      .map((m) => ({ value: `${m.provider}|${m.id}`, label: `${m.name}` })) ??
      []),
    ...(ownModels?.flatMap((p) =>
      p.models.map((id) => ({
        value: `${p.provider}|${id}`,
        label: `${p.label} · ${id} (your key)`,
      })),
    ) ?? []),
  ].filter((o, i, all) => all.findIndex((x) => x.value === o.value) === i);

  return {
    setup,
    setupError,
    agent,
    pickAgent,
    modelChoice,
    setModelChoice,
    modelOptions,
    turns,
    setTurns,
    busy,
    send,
    current,
    answered,
  };
}
