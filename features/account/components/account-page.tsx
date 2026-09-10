"use client";

import { cn } from "cn";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { ChangePasswordForm } from "./change-password-form";
import { DeleteAccountPanel } from "./delete-account-panel";
import { PasskeysPanel } from "./passkeys-panel";
import { ProfileForm } from "./profile-form";
import { SessionsPanel } from "./sessions-panel";
import { TwoFactorPanel } from "./two-factor-panel";

/**
 * `/account` — artboard `2k`, right panel
 * (`docs/design/TradeOs-UI.dc.html:1393-1467`): Profile, Security, Sessions.
 *
 * ## This screen has no permission row, and that is deliberate
 *
 * **Not one of the fourteen account and security routes carries
 * `requireMember`, `requirePermission` or `requireVerifiedEmail`** — recorded
 * as a decision at `auth.route.ts:118-131,171-189,231-247` and
 * `user.route.ts:9-42`, and enforced by a test: a user with no `Member` row at
 * all still gets a 200 from `PATCH /users/me`
 * (`user-profile.test.ts:181-195`).
 *
 * So `/account` is absent from `ROUTE_PERMISSIONS` in `config/routes.ts` on
 * purpose, and **every panel below must render without an organization**.
 * Nothing here reads the organization except to format a date, and
 * `useOrganization` already falls back to UTC when there is no business rather
 * than firing a request that would answer "you do not belong to a business
 * yet".
 *
 * The tab lives in the URL through `nuqs`, like `/settings` — `/account?tab=security`
 * is a linkable answer to "where do I turn on two-factor".
 */
const ACCOUNT_TABS = ["profile", "security", "sessions"] as const;

const TAB_LABELS: Record<(typeof ACCOUNT_TABS)[number], string> = {
  profile: "Profile",
  security: "Security",
  sessions: "Sessions",
};

const tabParser = parseAsStringLiteral(ACCOUNT_TABS).withDefault("profile");

export function AccountPage() {
  const [tab, setTab] = useQueryState("tab", tabParser);

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <h1 className="font-serif text-3xl leading-tight text-foreground">
        Account
      </h1>

      <div
        role="tablist"
        aria-label="Account sections"
        className="flex gap-6 border-border border-b"
      >
        {ACCOUNT_TABS.map((value) => {
          const isActive = value === tab;
          return (
            <button
              key={value}
              type="button"
              role="tab"
              id={`account-tab-${value}`}
              aria-selected={isActive}
              aria-controls={`account-panel-${value}`}
              onClick={() => void setTab(value, { history: "push" })}
              className={cn(
                "-mb-px border-b-2 px-0.5 pb-[11px] text-[13px] transition-colors",
                isActive
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {TAB_LABELS[value]}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`account-panel-${tab}`}
        aria-labelledby={`account-tab-${tab}`}
        className="flex flex-col gap-5"
      >
        {tab === "profile" ? (
          <>
            <ProfileForm />
            {/*
              The delete panel lives on Profile rather than Security: it is
              about the account as a thing that exists, not about how it is
              protected, and putting an irreversible action at the bottom of the
              screen holding password fields invites the wrong muscle memory.
            */}
            <DeleteAccountPanel />
          </>
        ) : null}

        {tab === "security" ? (
          <>
            <ChangePasswordForm />
            <TwoFactorPanel />
            <PasskeysPanel />
          </>
        ) : null}

        {tab === "sessions" ? <SessionsPanel /> : null}
      </div>
    </div>
  );
}
