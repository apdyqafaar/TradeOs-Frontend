import type { Metadata } from "next";
import { RegisterFlow } from "@/features/auth/components/register-form";

export const metadata: Metadata = {
  title: "Create account",
};

/**
 * Create an account. Not in the design canvas — built to artboard `1f`'s
 * conventions (400px column, 36px serif headline, 44px fields at 10px radius).
 *
 * A Server Component holding one client child, so the `metadata` above still
 * ships: `RegisterFlow` owns the `email | null` that decides between the form
 * and the check-your-email panel, and the headline changes with it.
 */
export default function RegisterPage() {
  return <RegisterFlow />;
}
