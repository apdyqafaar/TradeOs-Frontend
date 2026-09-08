import type { Metadata } from "next";
import { VerifyEmailPanel } from "@/features/auth/components/verify-email-panel";

export const metadata: Metadata = {
  title: "Confirm your email",
};

/** A `?token=` that arrived twice is still one token; take the first. */
const firstValue = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
};

/**
 * The screen the link in the verification email opens.
 *
 * `searchParams` is read here rather than through `useSearchParams` in the
 * panel. Both work; this one keeps the token out of the client bundle's
 * hook graph and needs no `<Suspense>` boundary, at the cost of rendering the
 * page dynamically — which it would be anyway, since its entire content depends
 * on a query parameter. In Next 16 the prop is a **Promise** and has to be
 * awaited (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`).
 *
 * The page is public: `POST /auth/verify-email` takes no session, because the
 * token itself is the credential and the mailbox is rarely open on the device
 * that registered. `proxy.ts` needs no entry to allow that — it is a deny-list
 * and this path is in neither array, so it renders in both the signed-in and
 * signed-out states. What matters is that it is never added to
 * `GUEST_ONLY_PATHS`; the comment there says why.
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const token = firstValue((await searchParams).token);

  return <VerifyEmailPanel token={token} />;
}
