import { headers } from "next/headers";
import Link from "next/link";
import { AuthFrame } from "@/components/auth-frame";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth";
import { getPendingInvitation } from "@/lib/invitations";
import {
  AcceptAsSignedIn,
  RegisterAndAccept,
  SignOutLink,
} from "./invite-forms";

export default async function AcceptInvitationPage({
  params,
}: PageProps<"/accept-invitation/[id]">) {
  const { id } = await params;
  const inv = await getPendingInvitation(id);

  if (!inv) {
    return (
      <AuthFrame
        title="This invitation has expired"
        subtitle="It may have already been used or replaced. Ask whoever invited you to send a new one."
      >
        <Button asChild variant="outline" size="lg" className="w-full">
          <Link href="/sign-in">Go to sign in</Link>
        </Button>
      </AuthFrame>
    );
  }

  const session = await auth.api.getSession({ headers: await headers() });
  const role = inv.roleName ?? "Member";
  const title = `Join ${inv.orgName} on Captap`;
  const subtitle = (
    <>
      You&apos;ve been invited with the {role} role, as{" "}
      <strong className="text-foreground">{inv.email}</strong>.
    </>
  );

  if (!session) {
    return (
      <AuthFrame title={title} subtitle={subtitle}>
        <RegisterAndAccept
          invitationId={inv.id}
          email={inv.email}
          orgName={inv.orgName}
        />
        <p className="mt-6 text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href={`/sign-in?next=${encodeURIComponent(`/accept-invitation/${inv.id}`)}`}
            className="font-medium text-foreground underline underline-offset-4"
          >
            Sign in
          </Link>
        </p>
      </AuthFrame>
    );
  }

  const sameEmail =
    session.user.email.toLowerCase() === inv.email.toLowerCase();
  if (!sameEmail) {
    return (
      <AuthFrame title={title} subtitle={subtitle}>
        <p className="rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
          You&apos;re signed in as <strong>{session.user.email}</strong>. This
          invitation can only be accepted by {inv.email}.
        </p>
        <p className="mt-6 text-sm text-muted-foreground">
          <SignOutLink label={`Sign out and continue as ${inv.email}`} />
        </p>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title={title} subtitle={subtitle}>
      <AcceptAsSignedIn invitationId={inv.id} orgName={inv.orgName} />
    </AuthFrame>
  );
}
