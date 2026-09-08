import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign in",
};

/**
 * SCAFFOLDING. The real page (section 6.1) carries the email/password form, the
 * passkey button, the 2FA and onboarding branches on the login response, and
 * the UNAUTHORIZED / TOO_MANY_REQUESTS banners. It arrives with the auth
 * feature; only the frame is here.
 */
export default function LoginPage() {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="font-serif text-[34px] leading-[1.15] tracking-tight">
        Your business, in order.
      </h1>
      <p className="text-muted-foreground text-sm">
        The sign-in form arrives with the auth feature.
      </p>
    </div>
  );
}
