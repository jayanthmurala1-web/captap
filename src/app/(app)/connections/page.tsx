import { redirect } from "next/navigation";
import { listConnections } from "@/lib/connections";
import { oauthConfigured } from "@/lib/connections-oauth";
import { secretsConfigured } from "@/lib/secrets";
import { requireSession } from "@/lib/session";
import { ConnectorGrid } from "./connector-grid";

export default async function ConnectionsPage({
  searchParams,
}: PageProps<"/connections">) {
  const { user, session } = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId) redirect("/");
  const { connected, error } = await searchParams;
  const connections = await listConnections(user.id, orgId);

  return (
    <main className="flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
        <p className="mt-1 text-muted-foreground">
          Notify your team where they work, verify delivery against a second
          source, or attach any other tool that speaks MCP.
        </p>
      </div>

      {typeof connected === "string" && (
        <p
          role="status"
          className="rounded-xl border border-success/40 bg-success/5 px-4 py-3 text-sm text-success"
        >
          Connected to {connected === "slack" ? "Slack" : "GitHub"}.
        </p>
      )}
      {typeof error === "string" && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <ConnectorGrid
        connections={connections}
        slackOAuthReady={oauthConfigured("slack")}
        githubOAuthReady={oauthConfigured("github")}
        canStore={secretsConfigured()}
      />
    </main>
  );
}
