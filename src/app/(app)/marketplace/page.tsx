import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listMarketplaceSkills } from "@/lib/marketplace";
import { requireSession } from "@/lib/session";
import { seedMarketplaceAction } from "./actions";

export default async function MarketplacePage({
  searchParams,
}: PageProps<"/marketplace">) {
  await requireSession();
  const { q } = await searchParams;
  const query = typeof q === "string" ? q : undefined;
  const skills = await listMarketplaceSkills(query);

  return (
    <main className="flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Marketplace</h1>
        <p className="mt-1 text-muted-foreground">
          Agents published by other orgs. If your org doesn&apos;t have a strong
          PRD, review or QA process yet, adopt one here instead of starting from
          a blank agent.
        </p>
      </div>

      <form className="flex gap-2">
        <Input
          name="q"
          defaultValue={query}
          placeholder="Search agents…"
          className="max-w-sm"
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      {skills.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
          {query ? (
            "No agents match that search."
          ) : (
            <form
              action={seedMarketplaceAction}
              className="flex flex-col gap-3"
            >
              <p>Nothing published yet.</p>
              <Button type="submit" variant="outline" className="self-start">
                Add Captap&apos;s starter agents
              </Button>
            </form>
          )}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {skills.map((s) => (
            <li key={s.id}>
              <Link
                href={`/marketplace/${s.id}`}
                className="flex h-full flex-col gap-2 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{s.title}</span>
                  <Badge variant="secondary">
                    {s.kind === "review" ? "Reviewer" : "Specialist"}
                  </Badge>
                </span>
                <span className="line-clamp-2 text-sm text-muted-foreground">
                  {s.pitch}
                </span>
                <span className="mt-auto flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                  by {s.publisherLabel}
                  {s.githubRepo && <ExternalLink className="size-3.5" />}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
