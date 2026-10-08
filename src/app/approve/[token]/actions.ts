"use server";

import { headers } from "next/headers";
import { submitApproval } from "@/lib/document-share";
import { DomainError } from "@/lib/errors";
import { checkLimit, clientIp } from "@/lib/rate-limit";

export type ApprovalFormState =
  | {
      error?: string;
      receipt?: {
        decision: "approved" | "changes_requested";
        version: number;
        approverName: string;
        recordedAt: string;
      };
    }
  | undefined;

export async function submitApprovalAction(
  _: ApprovalFormState,
  form: FormData,
): Promise<ApprovalFormState> {
  const token = String(form.get("token"));
  const decision = String(form.get("decision"));
  if (decision !== "approved" && decision !== "changes_requested") {
    return { error: "Invalid decision" };
  }
  const limit = await checkLimit("approve", clientIp(await headers()));
  if (!limit.ok) {
    const mins = Math.ceil(limit.retryAfter / 60);
    return {
      error: `Too many attempts from this connection. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
    };
  }
  try {
    const row = await submitApproval(token, {
      decision,
      approverName: String(form.get("approverName") ?? ""),
      approverEmail: String(form.get("approverEmail") ?? "") || undefined,
      note: String(form.get("note") ?? "") || undefined,
      version: Number(form.get("version")),
    });
    return {
      receipt: {
        decision: row.decision,
        version: row.version,
        approverName: row.approverName,
        recordedAt: row.createdAt.toISOString(),
      },
    };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}
