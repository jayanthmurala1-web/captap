import type { Metadata } from "next";
import "./client.css";

// Client-facing, capability-link pages: never indexed, and the token never leaks via Referer
// when the client clicks a link inside the shared document.
export const metadata: Metadata = {
  title: "Review request · Captap",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// Always light, independent of the app's theme (spec 014): the client didn't choose our app,
// and a light page reads like the document they're signing off on.
export default function ApproveLayout({ children }: LayoutProps<"/approve">) {
  return <div className="client-page min-h-dvh">{children}</div>;
}
