import { expect, test } from "vitest";
import {
  type AssistantTurn,
  applyConsultEvent,
  emptyTurn,
  parseSseChunk,
} from "./consult-events";

// The drawer used to read fields the harness never sends (content vs text,
// tool_call vs tool_start), so every answer rendered empty. These pin the contract.

test("text chunks accumulate into the answer", () => {
  let t: AssistantTurn = emptyTurn();
  t = applyConsultEvent(t, { type: "chunk", text: "Two tasks " });
  t = applyConsultEvent(t, { type: "chunk", text: "need review." });
  expect(t.text).toBe("Two tasks need review.");
});

test("tool start/end tracked by name, in order", () => {
  let t = emptyTurn();
  t = applyConsultEvent(t, {
    type: "tool_start",
    tool: "list_tasks",
    args: {},
  });
  expect(t.tools).toEqual([
    { id: "list_tasks:0", name: "list_tasks", done: false },
  ]);
  t = applyConsultEvent(t, {
    type: "tool_end",
    tool: "list_tasks",
    result: [],
  });
  expect(t.tools).toEqual([
    { id: "list_tasks:0", name: "list_tasks", done: true },
  ]);
});

test("errors and the model that answered are kept; done marks completion", () => {
  let t = emptyTurn();
  t = applyConsultEvent(t, {
    type: "started",
    agent: "code-review",
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    keySource: "org",
  });
  t = applyConsultEvent(t, {
    type: "telemetry",
    tokens: { input: 1, output: 1, total: 2 },
    costUsd: "0",
    modelName: "claude-haiku-4-5-20251001",
    provider: "anthropic",
    keySource: "org",
    estimated: false,
  });
  t = applyConsultEvent(t, { type: "error", error: "Rate limited" });
  t = applyConsultEvent(t, { type: "done" });
  expect(t).toMatchObject({
    agent: "code-review",
    provider: "anthropic",
    keySource: "org",
    model: "claude-haiku-4-5-20251001",
    error: "Rate limited",
    done: true,
  });
});

test("SSE parsing handles events split across network chunks", () => {
  const first = parseSseChunk("", 'data: {"type":"chunk","text":"Hel');
  expect(first.events).toEqual([]);
  const second = parseSseChunk(first.rest, 'lo"}\n\ndata: {"type":"done"}\n\n');
  expect(second.events).toEqual([
    { type: "chunk", text: "Hello" },
    { type: "done" },
  ]);
  expect(second.rest).toBe("");
});
