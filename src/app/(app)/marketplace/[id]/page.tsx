import { ChevronRight, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { capabilitiesOf, NotFoundError, requireMember } from "@/lib/access";
import { getMarketplaceSkill } from "@/lib/marketplace";
import { requireSession } from "@/lib/session";
import { formatDateShort } from "@/lib/utils";
import { AdoptButton } from "./adopt-button";
import { UnpublishButton } from "./unpublish-button";

export default async function MarketplaceSkillPage({
  params,
}: PageProps<"/marketplace/[id]">) {
  const { id } = await params;
  const { user, session } = await requireSession();
  const skill = await getMarketplaceSkill(id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });

  // Only the publishing org's own admins get an unpublish control — anyone else just browses.
  const canUnpublish =
    skill.orgId !== null &&
    skill.orgId === session.activeOrganizationId &&
    (
      await capabilitiesOf(
        skill.orgId,
        await requireMember(user.id, skill.orgId),
      )
    ).has("manage_org_settings");

  return (
    <main className="flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-8">
      <div>
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-1 text-sm text-muted-foreground"
        >
          <Link href="/marketplace" className="hover:text-foreground">
            Marketplace
          </Link>
          <ChevronRight className="size-3.5" />
          <span className="text-foreground">{skill.title}</span>
        </nav>
        <h1 className="mt-2 text-2xl font-semibold">{skill.title}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary">
            {skill.kind === "review" ? "Reviewer" : "Specialist"}
          </Badge>
          <span>by {skill.publisherLabel}</span>
          <span>updated {formatDateShort(skill.updatedAt)}</span>
          {skill.githubRepo && (
            <a
              href={skill.githubRepo}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-foreground"
            >
              <ExternalLink className="size-3.5" />
              repo
            </a>
          )}
        </p>
        <p className="mt-3 text-sm">{skill.pitch}</p>
      </div>

      <AdoptButton marketplaceSkillId={skill.id} agentName={skill.name} />
      {canUnpublish && <UnpublishButton id={skill.id} />}

      <pre className="overflow-x-auto whitespace-pre-wrap rounded-2xl border bg-card p-4 font-mono text-sm">
        {skill.source}
      </pre>
    </main>
  );
}
