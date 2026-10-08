"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import { CAPABILITY_INFO, type Capability } from "@/lib/capabilities";
import {
  createRoleAction,
  deleteRoleAction,
  type RoleResult,
  setMemberRoleAction,
  updateRoleAction,
} from "./role-actions";

export type RoleRow = {
  id: string;
  slug: string;
  name: string;
  isSystem: boolean;
  capabilities: Capability[];
};

const ALL = Object.keys(CAPABILITY_INFO) as Capability[];

/** Runs an action, showing its error message (if any) next to the control. */
function useAction() {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<RoleResult>, onOk?: () => void) =>
    start(async () => {
      const r = await fn();
      setError(r?.error);
      if (!r?.error) onOk?.();
    });
  return { error, pending, run };
}

export function MemberRoleSelect({
  userId,
  slug,
  roles,
}: {
  userId: string;
  slug: string;
  roles: RoleRow[];
}) {
  const { error, pending, run } = useAction();
  return (
    <span className="flex flex-col items-end gap-1">
      <span className="w-40">
        <OptionSelect
          label="Role"
          value={slug}
          options={roles.map((r) => ({ value: r.slug, label: r.name }))}
          onValueChange={(v) => run(() => setMemberRoleAction(userId, v))}
          className={pending ? "opacity-60" : undefined}
        />
      </span>
      {error && (
        <span
          role="alert"
          className="max-w-56 text-right text-xs text-destructive"
        >
          {error}
        </span>
      )}
    </span>
  );
}

function CapabilityChecks({
  value,
  onChange,
  disabled,
}: {
  value: Capability[];
  onChange: (v: Capability[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {ALL.map((c) => (
        <label key={c} className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 accent-primary"
            disabled={disabled}
            checked={value.includes(c)}
            onChange={(e) =>
              onChange(
                e.target.checked ? [...value, c] : value.filter((x) => x !== c),
              )
            }
          />
          <span>
            <span className="font-medium">{CAPABILITY_INFO[c].label}</span>
            <span className="block text-xs text-muted-foreground">
              {CAPABILITY_INFO[c].description}
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}

function RoleCard({ role }: { role: RoleRow }) {
  const locked = role.slug === "owner";
  const [name, setName] = useState(role.name);
  const [caps, setCaps] = useState(role.capabilities);
  const { error, pending, run } = useAction();
  const dirty =
    name !== role.name ||
    caps.length !== role.capabilities.length ||
    caps.some((c) => !role.capabilities.includes(c));
  return (
    <li className="flex flex-col gap-3 px-4 py-4">
      <div className="flex items-center gap-2">
        <Input
          aria-label="Role name"
          value={name}
          disabled={locked}
          onChange={(e) => setName(e.target.value)}
          className="max-w-56"
        />
        {locked && <Badge variant="outline">Always everything</Badge>}
      </div>
      <CapabilityChecks value={caps} onChange={setCaps} disabled={locked} />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!locked && (
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={!dirty || pending}
            onClick={() =>
              run(() => updateRoleAction(role.id, { name, capabilities: caps }))
            }
          >
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={pending}
            onClick={() => run(() => deleteRoleAction(role.id))}
          >
            Delete
          </Button>
        </div>
      )}
    </li>
  );
}

export function RolesPanel({ roles }: { roles: RoleRow[] }) {
  const [name, setName] = useState("");
  const [caps, setCaps] = useState<Capability[]>([]);
  const { error, pending, run } = useAction();
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="font-semibold">Roles</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A role is a set of permissions. A person has one workspace role and
          can have another on each project; they get both. Edit any role except
          Owner.
        </p>
      </div>
      <ul className="divide-y rounded-2xl border bg-card">
        {roles.map((r) => (
          <RoleCard
            key={`${r.id}-${r.name}-${r.capabilities.join()}`}
            role={r}
          />
        ))}
      </ul>
      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
        <h3 className="text-sm font-semibold">New role</h3>
        <Input
          aria-label="New role name"
          placeholder="e.g. Client reviewer"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="max-w-56"
        />
        <CapabilityChecks value={caps} onChange={setCaps} />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button
          className="self-start"
          size="sm"
          disabled={!name.trim() || pending}
          onClick={() =>
            run(
              () => createRoleAction(name, caps),
              () => {
                setName("");
                setCaps([]);
              },
            )
          }
        >
          Create role
        </Button>
      </div>
    </section>
  );
}
