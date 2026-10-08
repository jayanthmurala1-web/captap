import {
  Contact,
  isHostedService,
  LegalPage,
  SelfHostedNotice,
} from "../legal-page";

export const metadata = { title: "Privacy · Captap" };

export default function PrivacyPage() {
  if (!isHostedService())
    return (
      <LegalPage title="Privacy" updated="October 9, 2026">
        <SelfHostedNotice />
      </LegalPage>
    );
  return (
    <LegalPage title="Privacy" updated="October 9, 2026">
      <p>
        Captap is a free beta. This page says plainly what we store, why, and
        who else touches it. If anything here is unclear, write to <Contact />.
      </p>

      <h2>What we store</h2>
      <ul>
        <li>Your account: name, email address, and a hashed password.</li>
        <li>
          What your team puts in a workspace: projects, documents and PRDs,
          requirements, tasks, agents&apos; submitted evidence, review notes,
          learned rules, and the activity log.
        </li>
        <li>
          When a client approves a document by link: the name (and, if they give
          it, the email) they type in, and their decision.
        </li>
        <li>
          Connections you add (Slack, GitHub, MCP servers). Secrets are
          encrypted at rest and never shown again.
        </li>
        <li>
          Counts of AI usage per workspace, and short-lived request counts by IP
          address to rate-limit abuse.
        </li>
      </ul>

      <h2>Cookies</h2>
      <p>
        One cookie keeps you signed in and one remembers light or dark mode.
        There are no analytics, advertising or tracking cookies.
      </p>

      <h2>Who processes it</h2>
      <ul>
        <li>Vercel hosts the app. Neon stores the database.</li>
        <li>
          Resend sends our emails (invitations, decisions, confirmations).
        </li>
        <li>
          Groq runs the AI features. When you use Consult, or an agent submits
          work for an automated review, the relevant task, PRD and submission
          text is sent to Groq to produce the answer.
        </li>
        <li>
          Only if you turn them on: GitHub (to check commits and CI on a repo
          you link), Slack (messages to channels you connect), and Cloudinary
          (images you upload into documents).
        </li>
      </ul>
      <p>We don&apos;t sell your data or use it to train AI models.</p>

      <h2>Keeping and deleting it</h2>
      <p>
        You can delete projects, documents and tasks yourself at any time. To
        delete your account and everything in workspaces you alone own, write to{" "}
        <Contact /> from the email on the account.
      </p>

      <h2>During the beta</h2>
      <p>
        Please don&apos;t upload passwords, secrets, or regulated personal data
        (health, payment card or similar) into documents or tasks. If this page
        changes in a way that matters, we&apos;ll update the date above and tell
        workspace owners by email.
      </p>
    </LegalPage>
  );
}
