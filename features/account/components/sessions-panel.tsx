"use client";

import { useState } from "react";
import { ErrorCard } from "@/components/shared/error-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/config/routes";
import {
  useDeviceSessions,
  useLogoutEverywhere,
  useLogoutOthers,
} from "@/features/account/hooks/use-device-sessions";
import { describeUserAgent } from "@/features/account/lib/user-agent";
import type { DeviceSession } from "@/features/auth/services/auth.service";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import {
  AlertNote,
  InfoNote,
  SettingsPanel,
  SuccessNote,
} from "@/features/settings/components/form-primitives";
import { formatDate, formatDateTime } from "@/lib/format/date";

/**
 * "Sessions" on the Sessions tab — artboard `2k`
 * (`docs/design/TradeOs-UI.dc.html:1440-1458`).
 *
 * ## A read-only list plus two account-wide buttons. That is the whole API.
 *
 * The design draws a per-row control, and there is no endpoint behind it. The
 * entire session surface is `GET /auth/sessions`, `POST /auth/logout`,
 * `POST /auth/logout-all` and `POST /auth/logout-others` — verified by
 * exhaustive grep over `Backend/src/routes/`
 * (`docs/contracts/settings-account.md` §6). **There is no
 * `DELETE /auth/sessions/:id`**, and the `id` this endpoint returns per row is
 * a field with no consumer anywhere in the product.
 *
 * So no row has a "Sign out this device". Drawing one and wiring it to
 * `logout-others` would sign out three devices when the person asked to sign
 * out one; drawing one disabled would advertise a control that is not coming.
 * The note under the list says plainly that signing out one device is not
 * possible yet, so nobody hunts for it.
 *
 * ## Two more things the API cannot say, and this panel does not pretend to
 *
 * **No device parsing.** `userAgent` arrives raw or `null`;
 * `describeUserAgent` makes a shallow, honest guess and falls back to printing
 * the string rather than to "Unknown device".
 *
 * **No "last active".** There are two timestamps: `createdAt` (when this device
 * signed in) and `expiresAt`, which slides forward but is written **at most
 * once a day** (`session.service.ts:68-75`). Rendering `expiresAt` as activity
 * would say "active 20 hours ago" about a device that closed the tab a week
 * ago. It is labelled as an expiry, which is what it is.
 */
export function SessionsPanel() {
  const query = useDeviceSessions();
  const { timezone } = useOrganization();
  const others = useLogoutOthers();
  const everywhere = useLogoutEverywhere();

  const [confirmingEverywhere, setConfirmingEverywhere] = useState(false);
  const [revoked, setRevoked] = useState<number | null>(null);

  const sessions = query.data ?? [];
  const otherCount = sessions.filter((session) => !session.isCurrent).length;
  const busy = others.isPending || everywhere.isPending;

  return (
    <SettingsPanel
      title="Where you are signed in"
      description="Every device holding a live session on this account, newest first."
      action={
        <div className="flex flex-wrap gap-2">
          {/*
            Hidden rather than disabled when there is nothing to sign out, which
            is this repo's rule for a control somebody cannot use: with one
            session open, the request succeeds and reports "0 devices" to a
            person who expected an effect. It stays visible while the list is
            still loading, so the row does not shuffle under the cursor.
          */}
          {query.isPending || otherCount > 0 ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                setRevoked(null);
                others.mutate(undefined, {
                  onSuccess: (data) => setRevoked(data.revokedSessions),
                });
              }}
            >
              {others.isPending ? "Signing out…" : "Sign out other devices"}
            </Button>
          ) : null}
          <Button
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={() => setConfirmingEverywhere(true)}
          >
            Sign out everywhere
          </Button>
        </div>
      }
    >
      {confirmingEverywhere ? (
        <div className="flex flex-col gap-3 rounded-[10px] border border-destructive/30 bg-destructive-soft px-3.5 py-3">
          <p className="text-[13px] text-destructive-strong">
            This ends <strong>every</strong> session, including this one — you
            will be signed out here and will need to sign in again. To keep
            working on this device, use “Sign out other devices” instead.
          </p>
          <div className="flex gap-2.5">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setConfirmingEverywhere(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                everywhere.mutate(undefined, {
                  // A full navigation, not a router push: the cookie is gone
                  // and every cache in the tab has just been cleared, so
                  // re-mounting the app shell is the point rather than a cost.
                  onSettled: () => {
                    window.location.assign(ROUTES.login);
                  },
                })
              }
            >
              {everywhere.isPending ? "Signing out…" : "Sign out everywhere"}
            </Button>
          </div>
        </div>
      ) : null}

      {others.error ? <AlertNote>{others.error.message}</AlertNote> : null}
      {revoked === null ? null : (
        <SuccessNote>
          {revoked > 0
            ? `${revoked} other ${revoked === 1 ? "device was" : "devices were"} signed out. You are still signed in here.`
            : "There were no other devices to sign out."}
        </SuccessNote>
      )}

      {query.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-12 rounded-[10px]" />
          <Skeleton className="h-12 rounded-[10px]" />
        </div>
      ) : query.error ? (
        <ErrorCard
          error={query.error}
          title="Couldn't load your sessions"
          retry={() => void query.refetch()}
        />
      ) : (
        <ul className="flex flex-col">
          {sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              timezone={timezone}
            />
          ))}
        </ul>
      )}

      <InfoNote>
        Signing out a single device is not possible yet — TradeOs can end this
        session, all other sessions, or every session at once.
        {otherCount > 0
          ? ` You have ${otherCount} other ${otherCount === 1 ? "session" : "sessions"} open.`
          : ""}
      </InfoNote>
    </SettingsPanel>
  );
}

function SessionRow({
  session,
  timezone,
}: {
  session: DeviceSession;
  timezone: string;
}) {
  const device = describeUserAgent(session.userAgent);

  return (
    <li className="flex items-center gap-3 border-border/60 border-t py-3 first:border-t-0">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] text-foreground">
          {device.label ?? device.raw ?? "Device not recorded"}
        </span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {/* `ipAddress` is nullable — the API records `req.ip`, which is absent
              behind some proxy configurations. */}
          {session.ipAddress ? `${session.ipAddress} · ` : ""}
          signed in {formatDateTime(session.createdAt, timezone)} · expires{" "}
          {formatDate(session.expiresAt, timezone)}
        </span>
        {/* When the label was a guess, the raw string is still worth having:
            it is the only place the truth about this device is written down. */}
        {device.label && device.raw ? (
          <span
            className="truncate font-mono text-[10px] text-muted-foreground/70"
            title={device.raw}
          >
            {device.raw}
          </span>
        ) : null}
      </div>

      {session.isCurrent ? (
        <span className="inline-flex h-[22px] flex-none items-center rounded-lg bg-primary-soft px-2 font-medium text-[11px] text-primary-soft-foreground">
          This device
        </span>
      ) : null}
    </li>
  );
}
