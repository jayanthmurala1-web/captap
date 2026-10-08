"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function ProjectTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;
  const tabs = [
    { href: base, label: "Tasks" },
    { href: `${base}/documents`, label: "Documents" },
    { href: `${base}/approvals`, label: "Approvals" },
    { href: `${base}/settings`, label: "Settings" },
  ];

  return (
    <nav
      aria-label="Project"
      className="-mb-px mt-5 flex gap-1 overflow-x-auto [scrollbar-width:none]"
    >
      {tabs.map((t) => {
        const active =
          t.href === base ? pathname === base : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 border-b-2 border-transparent px-3 pb-3 text-sm text-muted-foreground transition-colors hover:text-foreground",
              active && "border-primary font-medium text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
