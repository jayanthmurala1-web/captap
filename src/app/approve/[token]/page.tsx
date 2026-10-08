import { notFound } from "next/navigation";
import { DocContent } from "@/components/doc-content";
import { getSharedDocument } from "@/lib/document-share";
import { NotFoundError } from "@/lib/errors";
import { ClientHeader } from "../client-header";
import { ApprovalForm } from "./approval-form";

export default async function ApprovePage({
  params,
}: PageProps<"/approve/[token]">) {
  const { token } = await params;
  const shared = await getSharedDocument(token).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });

  const updated = shared.updatedAt?.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <>
      <ClientHeader orgName={shared.orgName} />

      <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
        <div className="max-w-3xl">
          <p className="text-sm font-medium text-green-700">Review request</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-950 sm:text-3xl">
            {shared.title}
          </h1>
          <p className="mt-2 text-[15px] text-neutral-600">
            <span className="font-semibold text-neutral-900">
              {shared.orgName}
            </span>{" "}
            is asking you to review this document and approve it or request
            changes.
          </p>
          <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-500">
            <span className="rounded-full border border-neutral-300 bg-white px-2.5 py-0.5 font-medium text-neutral-700">
              Version {shared.version}
            </span>
            {updated && <span>Updated {updated}</span>}
            <a
              href="#decision"
              className="font-medium text-green-700 underline underline-offset-4 lg:hidden"
            >
              Jump to your decision ↓
            </a>
          </p>
        </div>

        <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <article className="rounded-2xl border border-neutral-200 bg-white px-5 py-8 shadow-sm sm:px-10 sm:py-10">
            <DocContent content={shared.content} className="client-doc" />
          </article>

          <aside id="decision" className="scroll-mt-6 lg:sticky lg:top-6">
            <ApprovalForm
              token={token}
              version={shared.version}
              title={shared.title}
            />
          </aside>
        </div>
      </main>
    </>
  );
}
