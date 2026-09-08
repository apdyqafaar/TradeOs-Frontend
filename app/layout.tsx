import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { env } from "@/config/env";
import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * The display serif (section 3.2): page greetings, auth headlines, empty-state
 * titles. Regular is the only weight Google publishes for it, and italic is
 * used by the public project page, so both styles are loaded.
 */
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  // Absolute URLs for share links and OG tags resolve against this.
  metadataBase: new URL(env.appUrl),
  title: {
    default: "TradeOs",
    template: "%s · TradeOs",
  },
  description:
    "Sales, stock, customers and debts for small trading businesses.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // next-themes writes the theme class onto <html> before hydration, which
    // is by definition a server/client mismatch on this element only.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
