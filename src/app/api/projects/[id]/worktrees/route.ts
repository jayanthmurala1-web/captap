import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { limitResponse } from "@/lib/rate-limit";
import { listProjectWorktrees } from "@/lib/worktree";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params;
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const limited = await limitResponse("api", session.user.id);
    if (limited) return limited;

    const url = new URL(req.url);
    const statusParam = url.searchParams.get("status");
    const status =
      statusParam === "active" ||
      statusParam === "submitted" ||
      statusParam === "merged" ||
      statusParam === "pruned"
        ? statusParam
        : undefined;

    const worktrees = await listProjectWorktrees(
      session.user.id,
      projectId,
      status,
    );
    return NextResponse.json({ worktrees });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
