"use client";

import { KeyRound } from "lucide-react";
import { useId, useState } from "react";
import { ErrorCard } from "@/components/shared/error-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MAX_PASSKEYS,
  useDeletePasskey,
  usePasskeys,
  useRegisterPasskey,
} from "@/features/account/hooks/use-passkeys";
import { isPasskeySupported } from "@/features/account/lib/webauthn";
import type { Passkey } from "@/features/auth/services/auth.service";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import {
  CONTROL,
  Field,
  InfoNote,
  SettingsPanel,
} from "@/features/settings/components/form-primitives";
import { formatDate } from "@/lib/format/date";

/**
 * "Passkeys" on the Security tab — artboard `2k`
 * (`docs/design/TradeOs-UI.dc.html:1440-1448`).
 *
 * ## What the API supports, and what the design asks for that it does not
 *
 * **No rename.** `passkeyRenameSchema` exists upstream at
 * `passkey.validation.ts:77` and **is imported by nothing** — there is no
 * `PATCH /auth/passkeys/:id`. A label is fixed at registration, which is why
 * the field is asked for deliberately, before the ceremony, and why the row has
 * no edit affordance.
 *
 * **No device type.** `transports` is stored and never returned
 * (`passkeys.test.ts:594-621` scans the body to prove it), so there is no
 * honest "security key" versus "this phone" icon. Every row gets the same
 * neutral key glyph.
 *
 * **`lastUsedAt` is real** and is `null` on a fresh one, which is the one
 * useful fact per row beyond the label.
 *
 * ## Support is checked before the button is drawn
 *
 * A browser without WebAuthn gets an explanation, not a control that always
 * fails. Same rule as the permission gates: never render a control that cannot
 * work.
 *
 * ## Passkey sign-in is not this panel's business
 *
 * `POST /auth/passkeys/login/*` is public and belongs to the login screen,
 * which `features/auth` owns. Worth knowing when that lands: `allowCredentials`
 * is deliberately absent from the login options, so the flow is
 * **usernameless/discoverable-only** — "Sign in with a passkey", never "…for
 * this email address" — and a passkey sign-in **bypasses 2FA entirely, on
 * purpose** (`passkey.service.ts:320-327`).
 */
export function PasskeysPanel() {
  const supported = isPasskeySupported();
  const query = usePasskeys();
  const { timezone } = useOrganization();
  const [adding, setAdding] = useState(false);

  const passkeys = query.data ?? [];
  const full = passkeys.length >= MAX_PASSKEYS;

  return (
    <SettingsPanel
      title="Passkeys"
      description="Sign in with your fingerprint, face or device PIN instead of a password."
      action={
        supported && !full && !adding ? (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <KeyRound aria-hidden="true" />
            Add a passkey
          </Button>
        ) : null
      }
    >
      {!supported ? (
        <InfoNote>
          This browser cannot create passkeys. Open TradeOs in a current Chrome,
          Safari, Edge or Firefox to add one.
        </InfoNote>
      ) : null}

      {full ? (
        <InfoNote>
          You have the maximum of {MAX_PASSKEYS} passkeys. Remove one before
          adding another.
        </InfoNote>
      ) : null}

      {adding ? <AddPasskeyForm onDone={() => setAdding(false)} /> : null}

      {query.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-11 rounded-[10px]" />
          <Skeleton className="h-11 rounded-[10px]" />
        </div>
      ) : query.error ? (
        <ErrorCard
          error={query.error}
          title="Couldn't load your passkeys"
          retry={() => void query.refetch()}
        />
      ) : passkeys.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          No passkeys yet. Your password still works either way — a passkey is
          an extra way in, not a replacement.
        </p>
      ) : (
        <ul className="flex flex-col">
          {passkeys.map((passkey) => (
            <PasskeyRow
              key={passkey.id}
              passkey={passkey}
              timezone={timezone}
            />
          ))}
        </ul>
      )}
    </SettingsPanel>
  );
}

function PasskeyRow({
  passkey,
  timezone,
}: {
  passkey: Passkey;
  timezone: string;
}) {
  const remove = useDeletePasskey();
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="flex flex-col gap-2 border-border/60 border-t py-3 first:border-t-0">
      <div className="flex items-center gap-3">
        <KeyRound
          aria-hidden="true"
          className="size-4 flex-none text-muted-foreground"
        />
        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
          {passkey.label}
        </span>
        <span className="flex-none font-mono text-[11px] text-muted-foreground">
          {passkey.lastUsedAt
            ? `used ${formatDate(passkey.lastUsedAt, timezone)}`
            : `added ${formatDate(passkey.createdAt, timezone)}`}
        </span>
        {confirming ? null : (
          <Button
            variant="ghost"
            size="sm"
            className="flex-none text-destructive hover:text-destructive"
            onClick={() => setConfirming(true)}
          >
            Remove
          </Button>
        )}
      </div>

      {confirming ? (
        <div className="flex flex-col gap-2.5 rounded-[10px] border border-destructive/30 bg-destructive-soft px-3.5 py-3">
          <p className="text-[13px] text-destructive-strong">
            Remove “{passkey.label}”? That device will no longer sign in without
            a password. This cannot be undone — you would register it again from
            scratch.
          </p>
          {remove.error ? (
            <p className="text-[13px] text-destructive-strong">
              {remove.error.message}
            </p>
          ) : null}
          <div className="flex gap-2.5">
            <Button
              variant="outline"
              size="sm"
              disabled={remove.isPending}
              onClick={() => {
                remove.reset();
                setConfirming(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(passkey.id, {
                  onSuccess: () => setConfirming(false),
                })
              }
            >
              {remove.isPending ? "Removing…" : "Remove"}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Label first, then the ceremony.
 *
 * The order is forced by the API — `label` is required on
 * `/passkeys/register/verify` and there is no rename route — but it is also the
 * better order: the browser's prompt takes over the screen, and asking someone
 * to name a device *after* they have authenticated to it gets "passkey 1".
 */
function AddPasskeyForm({ onDone }: { onDone: () => void }) {
  const uid = useId();
  const register = useRegisterPasskey();
  const [label, setLabel] = useState("");
  const [issue, setIssue] = useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();

    const trimmed = label.trim();
    if (trimmed.length === 0) {
      setIssue("Give this device a name you will recognise later.");
      return;
    }
    if (trimmed.length > 100) {
      setIssue("That name is too long — 100 characters at most.");
      return;
    }

    setIssue(null);
    register.mutate(
      { label: trimmed },
      {
        onSuccess: () => {
          setLabel("");
          onDone();
        },
        // Both a `PasskeyCeremonyError` (the browser refused or the person
        // dismissed the prompt) and an `ApiError` (the challenge expired, the
        // 20-passkey cap, a 429 from the shared register bucket) carry a
        // message written for a person. Neither is improved by this component
        // rewriting it.
        onError: (error) => setIssue(error.message),
      },
    );
  };

  const busy = register.isPending;

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3.5 rounded-[10px] border border-border bg-background p-4"
    >
      <Field
        id={`${uid}-label`}
        label="Name this device"
        error={issue ?? undefined}
        hint="You cannot rename it later, so pick something you will recognise — “Shop tablet”, “Amina's phone”."
      >
        {(props) => (
          <input
            {...props}
            value={label}
            disabled={busy}
            maxLength={100}
            autoComplete="off"
            placeholder="Shop tablet"
            onChange={(event) => setLabel(event.target.value)}
            className={CONTROL}
          />
        )}
      </Field>

      <div className="flex gap-2.5">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            register.reset();
            onDone();
          }}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Waiting for your device…" : "Continue"}
        </Button>
      </div>
    </form>
  );
}
