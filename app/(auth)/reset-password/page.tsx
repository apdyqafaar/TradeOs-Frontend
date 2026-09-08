import type { Metadata } from "next";
import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";

export const metadata: Metadata = {
  title: "Choose a new password",
};

/** A `?token=` that arrived twice is still one token; take the first. */
const firstValue = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
};

/**
 * Step two of a password reset — the screen the emailed link opens.
 *
 * `searchParams` is a **Promise** in Next 16 and is awaited here, which keeps
 * the token on the server side of the boundary and saves the `<Suspense>`
 * boundary `useSearchParams` would demand. See `verify-email/page.tsx` for the
 * same note.
 *
 * Public, and it must stay public: someone resetting a password is by
 * definition unable to sign in. `proxy.ts` needs no entry for that — it is a
 * deny-list and this path is in neither array — but it must never be added to
 * `GUEST_ONLY_PATHS`.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const token = firstValue((await searchParams).token);

  return <ResetPasswordForm token={token} />;
}
