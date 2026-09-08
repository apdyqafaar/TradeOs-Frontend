import type { Metadata } from "next";
import { OnboardingScreen } from "@/features/organization/components/onboarding-wizard";

export const metadata: Metadata = {
  title: "Create your business",
};

/**
 * The step between having an account and having an app.
 *
 * A Server Component holding metadata and nothing else: the centred 400px
 * column, the wordmark and the theme toggle all come from the `(auth)` layout,
 * and every part of this screen that reacts to a keystroke lives in
 * `OnboardingScreen`.
 *
 * It sits in `(auth)` rather than `(app)` because there is no tenant yet —
 * `useSession()` answers `organization: null` until `POST /organizations`
 * succeeds, so a sidebar here would have nothing to name and no permissions to
 * gate itself on. `proxy.ts` needs no entry for this path: it is neither
 * guest-only (a signed-in person is exactly who belongs here) nor inside the
 * app shell.
 */
export default function OnboardingPage() {
  return <OnboardingScreen />;
}
