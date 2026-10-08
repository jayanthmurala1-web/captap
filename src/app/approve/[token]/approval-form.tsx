"use client";

import { Check, MessageSquareText } from "lucide-react";
import { useActionState, useState } from "react";
import { type ApprovalFormState, submitApprovalAction } from "./actions";

const field =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-[15px] text-neutral-900 placeholder:text-neutral-400 focus:border-green-700 focus:outline-none focus:ring-2 focus:ring-green-700/20";
const label = "mb-1 block text-sm font-medium text-neutral-800";

export function ApprovalForm({
  token,
  version,
  title,
}: {
  token: string;
  version: number;
  title: string;
}) {
  const [state, action, pending] = useActionState<ApprovalFormState, FormData>(
    submitApprovalAction,
    undefined,
  );
  const [requestingChanges, setRequestingChanges] = useState(false);

  if (state?.receipt) return <Receipt {...state.receipt} title={title} />;

  return (
    <form
      action={action}
      className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <h2 className="text-lg font-semibold text-neutral-950">Your decision</h2>
      <p className="mt-1 text-sm leading-relaxed text-neutral-600">
        You&apos;re responding to <strong>version {version}</strong> exactly as
        shown. If the document changes later, your response stays attached to
        this version.
      </p>

      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="version" value={version} />

      <div className="mt-5 flex flex-col gap-4">
        <div>
          <label htmlFor="approverName" className={label}>
            Your name
          </label>
          <input
            id="approverName"
            name="approverName"
            required
            autoComplete="name"
            className={field}
          />
        </div>
        <div>
          <label htmlFor="approverEmail" className={label}>
            Email{" "}
            <span className="font-normal text-neutral-500">(optional)</span>
          </label>
          <input
            id="approverEmail"
            name="approverEmail"
            type="email"
            autoComplete="email"
            className={field}
          />
        </div>

        {requestingChanges && (
          <div>
            <label htmlFor="note" className={label}>
              What needs to change?
            </label>
            <textarea
              id="note"
              name="note"
              required
              rows={5}
              // biome-ignore lint/a11y/noAutofocus: the user just asked to write this note
              autoFocus
              className={field}
            />
          </div>
        )}
      </div>

      {state?.error && (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {state.error}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-2">
        {requestingChanges ? (
          <>
            <button
              type="submit"
              name="decision"
              value="changes_requested"
              disabled={pending}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-neutral-900 px-5 text-[15px] font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-60"
            >
              <MessageSquareText className="size-4" />
              {pending ? "Sending…" : "Send change request"}
            </button>
            <button
              type="button"
              onClick={() => setRequestingChanges(false)}
              disabled={pending}
              className="h-11 rounded-full px-5 text-[15px] font-medium text-neutral-600 transition hover:bg-neutral-100"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="submit"
              name="decision"
              value="approved"
              disabled={pending}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-green-700 px-5 text-[15px] font-semibold text-white transition hover:bg-green-800 disabled:opacity-60"
            >
              <Check className="size-4" />
              {pending ? "Recording…" : `Approve version ${version}`}
            </button>
            <button
              type="button"
              onClick={() => setRequestingChanges(true)}
              disabled={pending}
              className="h-11 rounded-full border border-neutral-300 bg-white px-5 text-[15px] font-medium text-neutral-800 transition hover:bg-neutral-50"
            >
              Request changes
            </button>
          </>
        )}
      </div>
    </form>
  );
}

function Receipt({
  decision,
  version,
  approverName,
  recordedAt,
  title,
}: NonNullable<NonNullable<ApprovalFormState>["receipt"]> & {
  title: string;
}) {
  const approved = decision === "approved";
  return (
    <section
      aria-live="polite"
      className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <div
        className={`flex size-10 items-center justify-center rounded-full ${approved ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}
      >
        {approved ? (
          <Check className="size-5" />
        ) : (
          <MessageSquareText className="size-5" />
        )}
      </div>
      <h2 className="mt-3 text-lg font-semibold text-neutral-950">
        {approved ? "Approved" : "Change request sent"}
      </h2>
      <p className="mt-1 text-sm text-neutral-600">
        Your response has been recorded against this exact version.
      </p>

      <dl className="mt-5 divide-y divide-neutral-200 rounded-xl border border-neutral-200 text-sm">
        {[
          ["Document", title],
          ["Version", String(version)],
          ["Decision", approved ? "Approved" : "Changes requested"],
          ["By", approverName],
          ["Recorded", new Date(recordedAt).toLocaleString()],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 px-4 py-2.5">
            <dt className="text-neutral-500">{k}</dt>
            <dd className="text-right font-medium text-neutral-900">{v}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-4 text-xs text-neutral-500">
        Save or screenshot this page for your records.
      </p>
    </section>
  );
}
