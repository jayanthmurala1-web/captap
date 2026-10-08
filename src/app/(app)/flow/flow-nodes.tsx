import { Handle, Position } from "@xyflow/react";
import {
  Briefcase,
  Code2,
  Rocket,
  ShieldCheck,
  Sparkles,
  TestTube2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { TaskRole } from "@/db/schema";
import { cn } from "@/lib/utils";

export function AgentNodeView({
  data,
}: {
  data: { label: string; kind: "guide" | "review" };
}) {
  const Icon = data.kind === "review" ? ShieldCheck : Sparkles;
  return (
    <div
      className={cn(
        "flex min-w-48 cursor-pointer items-center gap-2.5 rounded-xl border bg-card px-3.5 py-2.5 shadow-sm transition-colors hover:border-primary/50",
        data.kind === "review" ? "border-warning/40" : "border-primary/30",
      )}
    >
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-lg",
          data.kind === "review"
            ? "bg-warning/15 text-warning"
            : "bg-primary/15 text-primary",
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0">
        <p className="truncate font-mono text-xs font-medium">{data.label}</p>
        <Badge variant="secondary" className="mt-0.5 h-4 px-1.5 text-[10px]">
          {data.kind === "review" ? "Reviewer" : "Specialist"}
        </Badge>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-primary" />
    </div>
  );
}

const ROLE_ICON: Record<TaskRole, typeof Briefcase> = {
  product: Briefcase,
  developer: Code2,
  qa: TestTube2,
  devops: Rocket,
};

export function RoleNodeView({
  data,
}: {
  data: { label: string; role: TaskRole };
}) {
  const Icon = ROLE_ICON[data.role];
  return (
    <div className="flex min-w-40 items-center gap-2.5 rounded-xl border-2 bg-card px-3.5 py-2.5 shadow-sm">
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-muted-foreground/40"
      />
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground/10">
        <Icon className="size-3.5" />
      </span>
      <p className="text-sm font-semibold">{data.label}</p>
    </div>
  );
}
