import type { Metadata } from "next";
import { OverviewScreen } from "@/features/dashboard/components/overview";

export const metadata: Metadata = {
  title: "Overview",
};

/**
 * The Overview (brief §6.3, design canvas artboards `1c`, `1d` and `1e`).
 *
 * Stays a Server Component: it holds the metadata and nothing else. The whole
 * screen is one `GET /dashboard` plus the session's first name, so the client
 * boundary starts at `OverviewScreen` rather than here — a `"use client"` on a
 * page drags its entire subtree into the bundle for no gain.
 */
export default function OverviewPage() {
  return <OverviewScreen />;
}
