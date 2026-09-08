import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/features/auth/components/forgot-password-form";

export const metadata: Metadata = {
  title: "Forgot password",
};

/**
 * Step one of a password reset.
 *
 * A Server Component holding metadata and nothing else — the 400px column, the
 * wordmark and the theme toggle all come from the `(auth)` layout, and the
 * headline belongs to `ForgotPasswordForm` because it changes when the form is
 * replaced by its confirmation.
 */
export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
