"use client";

import { ArrowUp, Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CompactSelect, ConsultTurns } from "@/components/consult-drawer";
import { Textarea } from "@/components/ui/textarea";
import { useConsult } from "@/components/use-consult";

const EXAMPLES = [
  {
    icon: Sparkles,
    title: "Review open work",
    body: "What needs my review across my projects?",
  },
  {
    icon: Sparkles,
    title: "Project status",
    body: "Summarize where this project stands.",
  },
  {
    icon: Sparkles,
    title: "Break down a PRD",
    body: "Break the PRD into tasks with acceptance criteria.",
  },
];

export function AgentHero() {
  const [dismissedExamples, setDismissedExamples] = useState(false);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const {
    setup,
    setupError,
    agent,
    pickAgent,
    modelChoice,
    setModelChoice,
    modelOptions,
    turns,
    busy,
    send,
  } = useConsult({ active: true });

  useEffect(() => {
    if (turns.length > 0) endRef.current?.scrollIntoView({ block: "end" });
  }, [turns.length]);

  const submit = (text: string) => {
    if (!agent) return;
    send(text);
    setInput("");
  };

  if (turns.length > 0) {
    return (
      <div className="flex w-full max-w-3xl flex-1 flex-col gap-6">
        <div className="flex-1 overflow-y-auto">
          <ConsultTurns turns={turns} />
          <div ref={endRef} />
        </div>
        <InputBar
          input={input}
          setInput={setInput}
          onSubmit={submit}
          agent={agent}
          busy={busy}
          setup={setup}
          pickAgent={pickAgent}
          modelChoice={modelChoice}
          setModelChoice={setModelChoice}
          modelOptions={modelOptions}
        />
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-2xl flex-col gap-6">
      <InputBar
        input={input}
        setInput={setInput}
        onSubmit={submit}
        agent={agent}
        busy={busy}
        setup={setup}
        pickAgent={pickAgent}
        modelChoice={modelChoice}
        setModelChoice={setModelChoice}
        modelOptions={modelOptions}
      />

      {setupError && (
        <p role="alert" className="text-center text-sm text-destructive">
          {setupError}
        </p>
      )}

      {!dismissedExamples && setup && (
        <div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Get started with some examples
            </p>
            <button
              type="button"
              onClick={() => setDismissedExamples(true)}
              aria-label="Dismiss examples"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.title}
                type="button"
                onClick={() => {
                  if (!agent && setup.agents[0])
                    pickAgent(setup.agents[0].name);
                  submit(ex.body);
                }}
                className="flex flex-col items-start gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/40"
              >
                <ex.icon className="size-4 text-muted-foreground" />
                <span>
                  <span className="block text-sm font-semibold">
                    {ex.title}
                  </span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">
                    {ex.body}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function InputBar({
  input,
  setInput,
  onSubmit,
  agent,
  busy,
  setup,
  pickAgent,
  modelChoice,
  setModelChoice,
  modelOptions,
}: {
  input: string;
  setInput: (v: string) => void;
  onSubmit: (text: string) => void;
  agent: string | null;
  busy: boolean;
  setup: ReturnType<typeof useConsult>["setup"];
  pickAgent: (name: string) => void;
  modelChoice: string;
  setModelChoice: (v: string) => void;
  modelOptions: { value: string; label: string }[];
}) {
  return (
    <form
      className="rounded-2xl border bg-card p-4 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(input);
      }}
    >
      <Textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit(input);
          }
        }}
        rows={2}
        placeholder="Ask Captap…"
        aria-label="Message"
        className="min-h-14 resize-none border-0 px-1 text-base shadow-none focus-visible:ring-0"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {setup ? (
            <>
              <CompactSelect
                value={agent ?? ""}
                onValueChange={pickAgent}
                options={setup.agents.map((a) => ({
                  value: a.name,
                  label: a.name,
                }))}
                placeholder="Skills"
              />
              <CompactSelect
                value={modelChoice}
                onValueChange={setModelChoice}
                options={modelOptions}
                placeholder="Model"
              />
            </>
          ) : (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Loading…
            </span>
          )}
        </div>
        <button
          type="submit"
          disabled={busy || !agent || !input.trim()}
          aria-label="Send"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
        >
          <ArrowUp className="size-4" />
        </button>
      </div>
    </form>
  );
}
