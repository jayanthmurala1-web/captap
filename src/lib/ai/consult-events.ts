import type { ConsultEvent } from "./consult";

/** One assistant reply as the drawer shows it, built from the runner's stream events. */
export type AssistantTurn = {
  text: string;
  /** Who is answering, from the runner's `started` event. */
  agent?: string;
  provider?: string;
  keySource?: "org" | "platform";
  tools: { id: string; name: string; done: boolean }[];
  model?: string;
  error?: string;
  done: boolean;
};

export const emptyTurn = (): AssistantTurn => ({
  text: "",
  tools: [],
  done: false,
});

/** Pure reducer, typed against the runner's own ConsultEvent so the two can't drift apart. */
export function applyConsultEvent(
  t: AssistantTurn,
  e: ConsultEvent,
): AssistantTurn {
  switch (e.type) {
    case "chunk":
      return { ...t, text: t.text + e.text };
    case "tool_start":
      return {
        ...t,
        // Calls are append-only, so name + position is a stable id.
        tools: [
          ...t.tools,
          { id: `${e.tool}:${t.tools.length}`, name: e.tool, done: false },
        ],
      };
    case "tool_end": {
      // Mark the earliest still-running call with this name as finished.
      const i = t.tools.findIndex((x) => x.name === e.tool && !x.done);
      if (i === -1) return t;
      const tools = t.tools.slice();
      tools[i] = { ...tools[i], done: true };
      return { ...t, tools };
    }
    case "started":
      return {
        ...t,
        agent: e.agent,
        provider: e.provider,
        model: e.model,
        keySource: e.keySource,
      };
    case "telemetry":
      return { ...t, model: e.modelName };
    case "error":
      return { ...t, error: e.error };
    case "done":
      return { ...t, done: true };
  }
}

/** Splits an SSE byte stream into events; `rest` carries a partial event to the next read. */
export function parseSseChunk(rest: string, chunk: string) {
  const parts = (rest + chunk).split("\n\n");
  const tail = parts.pop() ?? "";
  const events: ConsultEvent[] = [];
  for (const part of parts) {
    const line = part.trim();
    if (!line.startsWith("data:")) continue;
    events.push(JSON.parse(line.slice(5).trim()) as ConsultEvent);
  }
  return { events, rest: tail };
}
