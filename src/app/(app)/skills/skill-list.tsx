import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { listSkills } from "@/lib/skills";

type Skill = Awaited<ReturnType<typeof listSkills>>[number];

export function SkillList({
  skills,
  showScope,
}: {
  skills: Skill[];
  showScope?: boolean;
}) {
  if (skills.length === 0)
    return (
      <p className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">
        No skills yet.
      </p>
    );
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {skills.map((s) => (
        <li key={s.id}>
          <Link
            href={`/skills/${s.id}`}
            className="flex h-full flex-col gap-2 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40"
          >
            <span className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-sm font-medium">
                {s.name}
              </span>
              <span className="flex shrink-0 gap-1">
                <Badge variant="secondary">
                  {s.kind === "review" ? "Reviewer" : "Specialist"}
                </Badge>
                {showScope && s.scope === "project" && (
                  <Badge variant="outline">This project</Badge>
                )}
              </span>
            </span>
            <span className="line-clamp-2 text-sm text-muted-foreground">
              {s.description || "No description."}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
