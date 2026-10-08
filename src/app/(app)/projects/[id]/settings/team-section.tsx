"use client";

import { useActionState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OptionSelect } from "@/components/ui/option-select";
import { addProjectMemberAction, removeProjectMemberAction } from "../actions";

type Member = { userId: string; name: string; email: string; role: string };
type Candidate = { userId: string; name: string; email: string };

export function TeamSection({
  projectId,
  members,
  candidates,
  canManage,
  roles,
  ledgers,
}: {
  roles: { slug: string; name: string }[];
  projectId: string;
  members: Member[];
  candidates: Candidate[];
  canManage: boolean;
  ledgers: Record<string, { id: string }>;
}) {
  const roleName = (slug: string) =>
    roles.find((r) => r.slug === slug)?.name ?? slug;
  const [addState, addAction, adding] = useActionState(
    addProjectMemberAction,
    undefined,
  );
  const [removeState, removeAction, removing] = useActionState(
    removeProjectMemberAction,
    undefined,
  );

  return (
    <div className="flex flex-col gap-4">
      <ul className="divide-y rounded-2xl border bg-card">
        {members.map((m) => (
          <li
            key={m.userId}
            className="flex flex-wrap items-center gap-3 px-4 py-3"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold uppercase text-primary">
              {(m.name || m.email).slice(0, 2)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{m.name}</span>
              <span className="block truncate text-sm text-muted-foreground">
                {m.email}
                {ledgers[m.userId] && (
                  <>
                    {" · "}
                    <a
                      href={`/documents/${ledgers[m.userId].id}`}
                      className="text-primary hover:underline"
                    >
                      work ledger
                    </a>
                  </>
                )}
              </span>
            </span>
            <Badge variant={m.role === "lead" ? "outline" : "secondary"}>
              {roleName(m.role)}
            </Badge>
            {canManage && m.role !== "lead" && (
              <form action={removeAction}>
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="targetUserId" value={m.userId} />
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  disabled={removing}
                  className="text-muted-foreground"
                >
                  Remove
                </Button>
              </form>
            )}
          </li>
        ))}
      </ul>
      {removeState?.error && (
        <p className="text-sm text-destructive">{removeState.error}</p>
      )}

      {canManage &&
        (candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Everyone in the workspace is on this project. Invite more people
            from{" "}
            <a href="/members" className="text-primary hover:underline">
              Team
            </a>
            .
          </p>
        ) : (
          <form
            action={addAction}
            className="grid gap-2 sm:grid-cols-[1fr_140px_auto]"
          >
            <input type="hidden" name="projectId" value={projectId} />
            <OptionSelect
              name="targetUserId"
              label="Person"
              defaultValue={candidates[0]?.userId}
              options={candidates.map((c) => ({
                value: c.userId,
                label: `${c.name} (${c.email})`,
              }))}
            />
            <OptionSelect
              name="role"
              label="Role on this project"
              defaultValue="developer"
              options={roles.map((r) => ({ value: r.slug, label: r.name }))}
            />
            <Button type="submit" variant="outline" disabled={adding}>
              {adding ? "Adding…" : "Add to project"}
            </Button>
          </form>
        ))}
      {addState?.error && (
        <p className="text-sm text-destructive">{addState.error}</p>
      )}
    </div>
  );
}
