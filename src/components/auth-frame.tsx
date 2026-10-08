import Link from "next/link";

/** Centered frame for the pages people see before they're in the app: sign-in, invitations, agent consent. */
export function AuthFrame({
  title,
  subtitle,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh w-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <p className="flex items-center gap-2">
          <span className="font-wordmark text-3xl leading-none text-primary">
            Captap
          </span>
          <BetaPill />
        </p>
        <h1 className="mt-8 text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-2 text-muted-foreground">{subtitle}</p>}
        <div className="mt-8">{children}</div>
        <p className="mt-10 flex gap-4 text-xs text-muted-foreground">
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-foreground">
            Terms
          </Link>
        </p>
      </div>
    </main>
  );
}

export function BetaPill() {
  return (
    <span className="rounded-full border border-primary/40 px-1.5 py-px text-[10px] font-medium uppercase tracking-wider text-primary">
      Beta
    </span>
  );
}
