"use client";

import { useState, useTransition } from "react";
import { OptionSelect } from "@/components/ui/option-select";
import { assignTaskAgentAction } from "../actions";

const AUTO = "auto";

/** Pin the agent that should do this task, or leave it to automatic matching. */
export function AgentPicker({
  taskId,
  current,
  agents,
}: {
  taskId: string;
  current: string | null;
  agents: string[];
}) {
  const [value, setValue] = useState(current ?? AUTO);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const change = (next: string) => {
    const before = value;
    setValue(next);
    setError(null);
    start(async () => {
      const res = await assignTaskAgentAction(
        taskId,
        next === AUTO ? null : next,
      );
      if (!res.ok) {
        setValue(before);
        setError(res.error ?? "Couldn't assign the agent");
      }
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <OptionSelect
        label="Agent"
        value={value}
        onValueChange={change}
        className={pending ? "opacity-60" : undefined}
        options={[
          { value: AUTO, label: "Auto-match from the task" },
          ...agents.map((a) => ({ value: a, label: a })),
        ]}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
