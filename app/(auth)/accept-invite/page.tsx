import type { Metadata } from "next";
import Link from "next/link";
import { ROUTES } from "@/config/routes";
import {
  AcceptInviteForm,
  InviteExpiredNotice,
} from "@/features/auth/components/accept-invite-form";
import { AuthCard } from "@/features/auth/components/auth-card";

export const metadata: Metadata = {
  title: "Accept your invitation",
};

/**
 * `/accept-invite?token=` — the link in the invitation email
 * (`Backend/src/lib/mailer.ts:106`, `buildFrontendUrl("/accept-invite", token)`).
 *
 * The headline is "Join the team" and not "Join {Business name}" the brief
 * asked for, because it cannot be: the inviting business's name is never
 * exposed to an unauthenticated caller. `POST /auth/accept-invite` is the only
 * public invite route in `docs/API-ROUTES.md`, and it answers *after* the
 * account exists — there is nothing to read the name from beforehand. The name
 * is in the email that carried this link ("… invited you to join {org} on
 * TradeOs"), so the person has already seen it; inventing a lookup endpoint to
 * repeat it here would be a public token-probe oracle.
 *
 * `searchParams` is awaited: it is a promise in this version of Next
 * (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`).
 */
export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  // `?token=a&token=b` parses to an array; take the first rather than sending
  // "a,b" to the API and getting back an unexplained 400.
  const invite = (Array.isArray(token) ? token[0] : token)?.trim() ?? "";

  return (
    <AuthCard
      headline="Join the team"
      subtitle={
        invite
          ? "Set a name and a password to finish accepting your invitation."
          : undefined
      }
      footer={
        <>
          Already have an account?{" "}
          <Link
            href={ROUTES.login}
            className="rounded-sm font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Sign in
          </Link>
        </>
      }
    >
      {/* No token in the URL is the same dead end as a rejected one — a
          truncated link pasted out of an email client, usually — so it gets the
          same calm panel rather than a form that can only fail. */}
      {invite ? <AcceptInviteForm token={invite} /> : <InviteExpiredNotice />}
    </AuthCard>
  );
}
