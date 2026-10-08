"use client";

import {
  ArrowUp,
  Check,
  Expand,
  Loader2,
  Minus,
  Sparkles,
  X,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { DocContent } from "@/components/doc-content";
import { Button } from "@/components/ui/button";
import { OptionSelect } from "@/components/ui/option-select";
import { Textarea } from "@/components/ui/textarea";
import { TOOL_LABEL } from "./consult-shared";
import { type Turn, useConsult } from "./use-consult";

export function ConsultDrawer() {
  const router = useRouter();
  const pathname = usePathname();
  const projectId = pathname.match(/^\/projects\/([^/]+)/)?.[1];
  const taskId = pathname.match(/^\/tasks\/([^/]+)/)?.[1];
  const [open, setOpen] = useState(false);
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
    setTurns,
    busy,
    send,
    current,
  } = useConsult({ projectId, taskId, active: open });

  if (!open) {
    return (
      <Button
        variant="outline"
        size="icon-lg"
        onClick={() => setOpen(true)}
        className="fixed right-5 bottom-5 z-40 rounded-full bg-card shadow-lg"
        aria-label="Open Consult"
        title="Consult an agent"
      >
        <Sparkles className="text-primary" />
      </Button>
    );
  }

  const submit = (text: string) => {
    send(text);
    setInput("");
    requestAnimationFrame(() =>
      endRef.current?.scrollIntoView({ block: "end" }),
    );
  };

  return (
    <div className="fixed right-5 bottom-5 z-40 flex w-[380px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <p className="text-sm font-medium">
          {agent ?? "New chat"}
          {current?.kind === "review" && (
            <span className="ml-1.5 text-xs text-muted-foreground">
              reviewer
            </span>
          )}
        </p>
        <div className="flex items-center gap-0.5 text-muted-foreground">
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Minimize"
            className="rounded-md p-1.5 hover:bg-muted"
          >
            <Minus className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => router.push("/agent")}
            aria-label="Expand to full page"
            className="rounded-md p-1.5 hover:bg-muted"
          >
            <Expand className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setTurns([]);
            }}
            aria-label="Close"
            className="rounded-md p-1.5 hover:bg-muted"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="flex max-h-[60vh] min-h-[280px] flex-col overflow-y-auto px-4 py-4">
        {setupError ? (
          <p role="alert" className="text-sm text-destructive">
            {setupError}
          </p>
        ) : !setup ? (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Loading…
          </span>
        ) : turns.length === 0 ? (
          <WelcomeState
            setup={setup}
            agent={agent}
            onPick={pickAgent}
            onSend={submit}
          />
        ) : (
          <ConsultTurns turns={turns} />
        )}
        <div ref={endRef} />
      </div>

      <form
        className="border-t p-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(input);
            }
          }}
          rows={1}
          placeholder={agent ? `Ask ${agent}…` : "Pick an agent below first"}
          aria-label="Message"
          className="max-h-32 min-h-9 resize-none border-0 px-1 shadow-none focus-visible:ring-0"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {setup && (
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
                />
              </>
            )}
          </div>
          <Button
            type="submit"
            size="icon"
            className="size-8 shrink-0 rounded-full"
            disabled={busy || !agent || !input.trim()}
            aria-label="Send"
          >
            <ArrowUp className="size-4" />
          </Button>
        </div>
      </form>
    </div>
  );
}

function WelcomeState({
  setup,
  agent,
  onPick,
  onSend,
}: {
  setup: NonNullable<ReturnType<typeof useConsult>["setup"]>;
  agent: string | null;
  onPick: (name: string) => void;
  onSend: (text: string) => void;
}) {
  if (!agent) {
    return (
      <div className="m-auto flex flex-col items-center gap-3 text-center">
        <Sparkles className="size-6 text-primary" />
        <p className="text-sm font-semibold">Welcome to Captap</p>
        <p className="text-xs text-muted-foreground">Pick an agent to start</p>
        <div className="flex flex-wrap justify-center gap-1.5">
          {setup.agents.map((a) => (
            <button
              key={a.name}
              type="button"
              onClick={() => onPick(a.name)}
              className="rounded-full border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary/40"
            >
              {a.name}
            </button>
          ))}
        </div>
      </div>
    );
  }
  const current = setup.agents.find((a) => a.name === agent);
  const starters =
    current?.kind === "review"
      ? [
          "What needs my review in this project?",
          "Which requirements have no work yet?",
        ]
      : [
          "What needs my review in this project?",
          "Summarize where this project stands.",
          "Break the PRD into tasks with acceptance criteria.",
        ];
  return (
    <div className="m-auto flex flex-col items-center gap-3 text-center">
      <Sparkles className="size-6 text-primary" />
      <p className="text-sm font-semibold">Welcome to Captap</p>
      <p className="text-xs text-muted-foreground">Ask {agent} anything</p>
      <div className="flex flex-wrap justify-center gap-1.5">
        {starters.slice(0, 2).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSend(s)}
            className="rounded-full border bg-background px-3 py-1.5 text-left text-xs font-medium transition-colors hover:border-primary/40"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ConsultTurns({ turns }: { turns: Turn[] }) {
  return (
    <ol className="flex flex-col gap-5">
      {turns.map((t) =>
        t.role === "user" ? (
          <li
            key={t.id}
            className="ml-8 self-end rounded-2xl rounded-br-md bg-primary/15 px-3.5 py-2 text-sm"
          >
            {t.text}
          </li>
        ) : (
          <li key={t.id} className="flex flex-col gap-2">
            {t.turn.tools.length > 0 && (
              <ul className="flex flex-col gap-1">
                {t.turn.tools.map((tool) => (
                  <li
                    key={tool.id}
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                  >
                    {tool.done ? (
                      <Check className="size-3.5 text-success" />
                    ) : (
                      <Loader2 className="size-3.5 animate-spin" />
                    )}
                    {TOOL_LABEL[tool.name] ?? tool.name}
                  </li>
                ))}
              </ul>
            )}
            {t.turn.text ? (
              <DocContent content={t.turn.text} className="prose-doc text-sm" />
            ) : (
              !t.turn.done &&
              !t.turn.error && (
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Thinking…
                </span>
              )
            )}
            {t.turn.error && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                {t.turn.error}
              </div>
            )}
          </li>
        ),
      )}
    </ol>
  );
}

/** A tiny pill-styled select — "Skills ⌄" / model, matching the compact bottom bar. */
export function CompactSelect({
  value,
  onValueChange,
  options,
  placeholder,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <OptionSelect
      value={value}
      onValueChange={onValueChange}
      options={options}
      label={placeholder}
      className="h-7 min-w-0 max-w-32 border-0 bg-muted px-2 text-xs shadow-none"
    />
  );
}
