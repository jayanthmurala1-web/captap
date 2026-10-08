"use client";

import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type Option = { value: string; label: string };

/**
 * The app's dropdown: themed (native <select> popups ignore the dark theme on Windows),
 * keyboard-accessible, and still submits with plain forms via `name`.
 */
export function OptionSelect({
  id,
  name,
  options,
  value,
  defaultValue,
  onValueChange,
  label,
  className,
}: {
  id?: string;
  name?: string;
  options: Option[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  /** Accessible name when there's no visible <Label htmlFor={id}>. */
  label?: string;
  className?: string;
}) {
  // Render the label ourselves so the server HTML already shows it (Radix fills
  // SelectValue in only after hydration, so every dropdown flashed blank on load).
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  const current = value ?? uncontrolled;
  const selectedLabel = options.find((o) => o.value === current)?.label;
  return (
    <Select
      name={name}
      value={value}
      defaultValue={defaultValue}
      onValueChange={(v) => {
        setUncontrolled(v);
        onValueChange?.(v);
      }}
    >
      <SelectTrigger
        id={id}
        aria-label={label}
        className={cn("w-full", className)}
      >
        <SelectValue>{selectedLabel ?? label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
