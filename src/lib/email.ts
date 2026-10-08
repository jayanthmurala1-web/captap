/**
 * Transactional email over Resend's REST API (spec 020, ADR-023). No SDK.
 * Sending is best-effort: it never throws into the action that triggered it, and every
 * failure is logged and returned as `sent: false`.
 */

// Never send to reserved/test addresses: bounces hurt the sender's reputation.
const RESERVED =
  /(\.local|\.test|\.invalid|\.example|\.localhost)$|@(example\.(com|org|net)|localhost)$/i;

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};
export type EmailResult = { sent: boolean; id?: string; error?: string };

export async function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY;
  if (RESERVED.test(msg.to.trim()))
    return { sent: false, error: "reserved address, not sent" };
  if (!key) {
    console.error(
      `email not sent (RESEND_API_KEY is not set): "${msg.subject}"`,
    );
    return { sent: false, error: "email is not configured" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from:
          process.env.EMAIL_FROM ?? "Captap <notifications@example.invalid>",
        to: [msg.to.trim()],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
    };
    if (!res.ok) {
      const error = `Resend ${res.status}: ${json.message ?? "request failed"}`;
      console.error(`email not sent to ${msg.to}: ${error}`);
      return { sent: false, error };
    }
    return { sent: true, id: json.id };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`email not sent to ${msg.to}: ${error}`);
    return { sent: false, error };
  }
}

/** Absolute link into the app, for use in emails. */
export function appLink(path: string) {
  return `${(process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "")}${path}`;
}

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** One plain layout for all three emails: heading, short paragraphs, one button. No tracking, no footer marketing. */
function layout(
  heading: string,
  paragraphs: string[],
  cta: { label: string; href: string },
) {
  const html = `<!doctype html><html><body style="margin:0;background:#f5f5f4;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1917">
<div style="max-width:520px;margin:0 auto;padding:32px 20px">
<p style="font-size:14px;color:#57534e;margin:0 0 16px">Captap</p>
<div style="background:#ffffff;border:1px solid #e7e5e4;border-radius:12px;padding:24px">
<h1 style="font-size:18px;margin:0 0 12px">${esc(heading)}</h1>
${paragraphs.map((p) => `<p style="font-size:15px;line-height:1.5;margin:0 0 12px">${esc(p)}</p>`).join("\n")}
<p style="margin:20px 0 0"><a href="${esc(cta.href)}" style="display:inline-block;background:#15803d;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:10px 18px;border-radius:999px">${esc(cta.label)}</a></p>
</div></div></body></html>`;
  const text = [
    heading,
    "",
    ...paragraphs,
    "",
    `${cta.label}: ${cta.href}`,
  ].join("\n");
  return { html, text };
}

export function verifyEmailMessage(a: { link: string }) {
  return {
    subject: "Confirm your email for Captap",
    ...layout(
      "Confirm your email",
      [
        "Click below to confirm this address and finish creating your Captap account.",
        "If you didn't sign up, ignore this email and nothing will happen.",
      ],
      { label: "Confirm my email", href: a.link },
    ),
  };
}

export function invitationEmail(a: {
  inviterName: string;
  orgName: string;
  roleName: string;
  link: string;
}) {
  const subject = `${a.inviterName} invited you to ${a.orgName} on Captap`;
  return {
    subject,
    ...layout(
      `Join ${a.orgName} on Captap`,
      [
        `${a.inviterName} invited you to ${a.orgName} with the ${a.roleName} role.`,
        "The link only works for this email address and expires in 7 days.",
      ],
      { label: "Accept the invitation", href: a.link },
    ),
  };
}

export function taskDecisionEmail(a: {
  decision: "approved" | "rejected";
  taskKey: string;
  taskTitle: string;
  note?: string;
  decidedBy: string;
  link: string;
}) {
  const approved = a.decision === "approved";
  return {
    subject: approved
      ? `${a.taskKey} approved: ${a.taskTitle}`
      : `${a.taskKey} sent back: ${a.taskTitle}`,
    ...layout(
      approved ? `${a.taskKey} was approved` : `${a.taskKey} was sent back`,
      [
        `${a.decidedBy} ${approved ? "approved" : "sent back"} “${a.taskTitle}”.`,
        ...(a.note ? [`Their note: ${a.note}`] : []),
      ],
      { label: "Open the task", href: a.link },
    ),
  };
}

export function clientDecisionEmail(a: {
  decision: "approved" | "changes_requested";
  clientName: string;
  documentTitle: string;
  version: number;
  note?: string;
  link: string;
}) {
  const approved = a.decision === "approved";
  return {
    subject: approved
      ? `${a.clientName} approved ${a.documentTitle}`
      : `${a.clientName} asked for changes to ${a.documentTitle}`,
    ...layout(
      approved ? "Your client approved" : "Your client asked for changes",
      [
        `${a.clientName} ${approved ? "approved" : "asked for changes to"} “${a.documentTitle}” (v${a.version}).`,
        ...(a.note ? [`Their note: ${a.note}`] : []),
      ],
      { label: "Open the document", href: a.link },
    ),
  };
}
