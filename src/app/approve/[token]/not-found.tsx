import { ClientHeader } from "../client-header";

// Same page for invalid and revoked links — don't reveal which (spec 013).
export default function ShareNotFound() {
  return (
    <>
      <ClientHeader />
      <main className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
        <h1 className="text-xl font-semibold text-neutral-950">
          This link is no longer active
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-neutral-600">
          It may have been replaced or withdrawn. Please contact the person who
          sent it to you for a new link.
        </p>
      </main>
    </>
  );
}
