import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  type ConsultEvent,
  prepareConsult,
  streamConsult,
} from "@/lib/ai/consult";
import { AiAccessError } from "@/lib/ai/model-access";
import {
  DomainError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { limitResponse } from "@/lib/rate-limit";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The browser can send the conversation and its choices; it can NOT send a system prompt (spec 021).
const body = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(100_000),
      }),
    )
    .min(1)
    .max(60),
  agentName: z.string().min(1).max(64),
  projectId: z.string().optional(),
  taskId: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
});

const statusOf = (e: unknown) =>
  e instanceof AiAccessError
    ? 402 // fixable by connecting a key / waiting for the allowance / upgrading
    : e instanceof ForbiddenError
      ? 403
      : e instanceof NotFoundError
        ? 404
        : e instanceof ValidationError
          ? 400
          : 500;

export async function POST(req: NextRequest) {
  let userId: string;
  let orgId: string | null | undefined;
  try {
    const { user, session } = await requireSession();
    userId = user.id;
    orgId = session.activeOrganizationId;
  } catch {
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  }
  if (!orgId)
    return NextResponse.json({ error: "No active workspace" }, { status: 400 });

  const limited = await limitResponse("consult", userId);
  if (limited) return limited;

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Pick an agent and send at least one message" },
      { status: 400 },
    );

  let prepared: Awaited<ReturnType<typeof prepareConsult>>;
  try {
    prepared = await prepareConsult(userId, { ...parsed.data, orgId });
  } catch (e) {
    if (e instanceof DomainError)
      return NextResponse.json(
        { error: e.message, code: e.constructor.name },
        { status: statusOf(e) },
      );
    console.error("Consult route error:", e);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: ConsultEvent) =>
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      try {
        await streamConsult(prepared, send, req.signal);
      } catch (err) {
        send({
          type: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
