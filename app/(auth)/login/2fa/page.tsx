import type { Metadata } from "next";
import Link from "next/link";
import { ROUTES } from "@/config/routes";
import { AuthCard } from "@/features/auth/components/auth-card";
import { TwoFactorForm } from "@/features/auth/components/two-factor-form";

export const metadata: Metadata = {
  title: "Enter your code",
};

/**
 * Step two of signing in — artboard `1f`
 * (`docs/design/TradeOs-UI.dc.html:2740`), light and dark.
 *
 * A Server Component holding metadata and the frame; everything that reacts to
 * a keystroke is in `TwoFactorForm`. No `<Suspense>` here, unlike `/login`:
 * this screen reads no query parameter, because a challenge token in the URL
 * would end up in the history and in every `Referer` the page emits.
 *
 * `proxy.ts` needs no entry for it. `GUEST_ONLY_PATHS` matches `/login`
 * exactly rather than by prefix, so a stale session cookie does not bounce a
 * half-signed-in caller away from the screen that would finish the job.
 */
export default function TwoFactorPage() {
  return (
    <AuthCard
      headline="Enter your code"
      subtitle="Open your authenticator app."
      footer={
        <Link
          href={ROUTES.login}
          className="rounded-sm font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Back to sign in
        </Link>
      }
    >
      <TwoFactorForm />
    </AuthCard>
  );
}
