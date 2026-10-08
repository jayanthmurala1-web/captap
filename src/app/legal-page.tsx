import Link from "next/link";

/** Shared shell for /privacy and /terms: readable width, the wordmark, a way back. */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-12">
      <Link
        href="/"
        className="font-wordmark text-3xl leading-none text-primary"
      >
        Captap
      </Link>
      <h1 className="mt-8 text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Last updated {updated}
      </p>
      <div className="mt-8 flex flex-col gap-5 leading-relaxed [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
        {children}
      </div>
    </main>
  );
}

/** True only on the hosted service. Self-hosted copies are run by someone else, so these policies don't apply to them. */
export const isHostedService = () => process.env.CAPTAP_CLOUD === "1";

export function SelfHostedNotice() {
  return (
    <p>
      This is a self-hosted copy of Captap, open-source software. Whoever runs
      this instance decides how your data is stored and handled. Ask them for
      their policies.
    </p>
  );
}

export function Contact() {
  const email = process.env.SUPPORT_EMAIL;
  return email ? (
    <a className="underline underline-offset-4" href={`mailto:${email}`}>
      {email}
    </a>
  ) : (
    <span>the contact address listed on our GitHub repository</span>
  );
}
