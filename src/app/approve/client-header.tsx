export function ClientHeader({ orgName }: { orgName?: string }) {
  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <span className="truncate font-semibold text-neutral-900">
          {orgName}
        </span>
        <span className="flex shrink-0 items-baseline gap-1.5 text-xs text-neutral-500">
          via
          <span className="font-wordmark text-lg leading-none text-green-700">
            Captap
          </span>
        </span>
      </div>
    </header>
  );
}
