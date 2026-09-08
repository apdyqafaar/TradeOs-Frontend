import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ROUTES } from "@/config/routes";
import { AuthCard } from "@/features/auth/components/auth-card";
import { LoginForm } from "@/features/auth/components/login-form";

export const metadata: Metadata = {
  title: "Sign in",
};

/** Sign in — artboard `1f`, light and dark. */
export default function LoginPage() {
  return (
    <div className="flex w-full max-w-[400px] flex-col gap-[22px]">
      <AuthCard
        headline="Your business, in order."
        subtitle="Sign in to your TradeOs account."
        footer={
          <>
            New to TradeOs?{" "}
            <Link
              href={ROUTES.register}
              className="rounded-sm font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Create an account
            </Link>
          </>
        }
      >
        {/* `LoginForm` reads `?next=`, and `useSearchParams` opts a page out of
            static rendering unless it sits behind a boundary. The fallback is
            the form's own height at 1440 (182 + 22 + 134), so the centred
            column does not jump if Next does fall back to the client. */}
        <Suspense fallback={<div className="h-[338px]" />}>
          <LoginForm />
        </Suspense>
      </AuthCard>

      <p className="text-pretty text-center text-[11px] text-muted-3 leading-[1.5]">
        By continuing you agree to the Terms of Service.
        <br />
        TradeOs keeps one business per account.
      </p>
    </div>
  );
}
