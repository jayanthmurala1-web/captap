import type { Metadata } from "next";
import { Fontdiner_Swanky, Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Wordmark only — never UI text (spec 014).
const wordmark = Fontdiner_Swanky({
  variable: "--font-fontdiner-swanky",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Captap",
  description: "Company skills, tasks and memory for AI-agent teams.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Dark by default; the toggle writes this cookie so the server renders the right class (no flash).
  const theme = (await cookies()).get("theme")?.value === "light" ? "" : "dark";
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${wordmark.variable} ${theme} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
