import Link from "next/link";
import {
  Contact,
  isHostedService,
  LegalPage,
  SelfHostedNotice,
} from "../legal-page";

export const metadata = { title: "Terms · Captap" };

export default function TermsPage() {
  if (!isHostedService())
    return (
      <LegalPage title="Terms" updated="October 9, 2026">
        <SelfHostedNotice />
      </LegalPage>
    );
  return (
    <LegalPage title="Terms of the beta" updated="October 9, 2026">
      <p>
        Captap&apos;s hosted service is a free beta. By using it you agree to
        these terms. Questions go to <Contact />.
      </p>

      <h2>It&apos;s a beta</h2>
      <p>
        It&apos;s free, it&apos;s provided as is, and things may break or
        change. There&apos;s no uptime guarantee. Keep your own copy of anything
        you can&apos;t afford to lose. If we ever wind the beta down or start
        charging, workspace owners get at least 30 days&apos; notice by email.
      </p>

      <h2>Your content stays yours</h2>
      <p>
        You own what you and your team put into Captap. We only use it to run
        the service for you, as described in the{" "}
        <Link href="/privacy" className="underline underline-offset-4">
          privacy page
        </Link>
        .
      </p>

      <h2>Fair use</h2>
      <ul>
        <li>Don&apos;t use Captap for anything illegal, or to harm others.</li>
        <li>
          Don&apos;t try to get at other workspaces&apos; data, overload the
          service, or get around its limits. To report a security issue, see our
          GitHub repository&apos;s security policy.
        </li>
        <li>
          You&apos;re responsible for what your agents do with the access you
          give them, and for having the right to share client documents here.
        </li>
      </ul>
      <p>
        We may suspend a workspace that breaks these rules, and will tell its
        owner why.
      </p>

      <h2>The software</h2>
      <p>
        Captap&apos;s code is open source under the GNU AGPL v3. You can run
        your own copy instead of using this hosted beta.
      </p>
    </LegalPage>
  );
}
