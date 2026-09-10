"use client";

import { cn } from "cn";
import { useEffect, useId, useState } from "react";
import { ErrorCard } from "@/components/shared/error-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useUpdateOrganization } from "@/features/organization/hooks/use-organization-mutations";
import { useOrganizationProfile } from "@/features/organization/hooks/use-organization-profile";
import {
  describeTimezone,
  TIMEZONES,
} from "@/features/organization/lib/timezones";
import { updateOrganizationSchema } from "@/features/organization/schemas/organization.schema";
import type { Organization } from "@/features/organization/types";
import { ImagePicker } from "@/features/uploads/components/image-picker";
import { fieldErrorsFor } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { PermissionGate } from "@/lib/auth/permission-gate";
import { PERMISSIONS } from "@/lib/auth/permissions";
import {
  AlertNote,
  ChevronGlyph,
  CONTROL,
  Field,
  SELECT_CONTROL,
  SettingsPanel,
  SuccessNote,
} from "./form-primitives";

/**
 * The Business tab of `/settings` — artboard `2k`
 * (`docs/design/TradeOs-UI.dc.html:1336-1358`): a logo, then name, timezone,
 * phone and address in a two-column grid, then Discard and Save changes.
 *
 * ## Three upstream behaviours this form is shaped by
 *
 * **`phone`, `address` and `logo` are absent from the JSON when unset, not
 * `null`** — a fresh organization is created with only `name`, `slug`,
 * `ownerId` and `timezone` (`organization.service.ts:126`). So a form bound to
 * `data.phone` gets `undefined`, and "key absent" and "empty string" have to be
 * the same empty state, which they are here because every text field is seeded
 * with `?? ""`.
 *
 * **`""` is a legal value for both** — min length 0 upstream — and it is the
 * only way to clear a phone number a business no longer uses. That is why
 * neither field carries a `.min(1)`.
 *
 * **A body of only stripped keys is a 422, not a no-op.** `{ currency: "USD" }`
 * strips to `{}` and then fails the "Provide at least one field to update"
 * refinement (`organization.test.ts:203-230`). This form only ever sends fields
 * the schema really has, so it cannot reach that state.
 */
export function BusinessForm() {
  const profile = useOrganizationProfile();

  if (profile.isPending) {
    return (
      <div className="flex flex-col gap-5">
        <Skeleton className="h-[150px] rounded-[10px]" />
        <Skeleton className="h-[196px] rounded-[10px]" />
      </div>
    );
  }

  if (profile.error) {
    return (
      <ErrorCard
        error={profile.error}
        title="Couldn't load your business"
        // A 403 answers the same way however many times it is asked, so
        // offering "Try again" would only repeat it.
        retry={
          profile.error.status === 403
            ? undefined
            : () => void profile.refetch()
        }
      />
    );
  }

  // Keyed on the id so the seeded editing state below is rebuilt if the tenant
  // ever changes underneath — a second account signing in on the same tab.
  return <BusinessFields key={profile.data.id} organization={profile.data} />;
}

function BusinessFields({ organization }: { organization: Organization }) {
  const uid = useId();
  const mutation = useUpdateOrganization();

  const [name, setName] = useState(organization.name);
  const [timezone, setTimezone] = useState(organization.timezone);
  const [phone, setPhone] = useState(organization.phone ?? "");
  const [address, setAddress] = useState(organization.address ?? "");
  /**
   * `undefined` = leave the logo alone; `null` = detach it; a string = attach
   * this newly uploaded image.
   *
   * Three states rather than two because "no change" and "remove the logo" are
   * different requests, and `logoUploadId: null` is the one that detaches and
   * deletes the stored image after the transaction commits
   * (`organization.service.ts:231-236,261`).
   */
  const [logoUploadId, setLogoUploadId] = useState<ObjectId | null | undefined>(
    undefined,
  );
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const dirty =
    name !== organization.name ||
    timezone !== organization.timezone ||
    phone !== (organization.phone ?? "") ||
    address !== (organization.address ?? "") ||
    logoUploadId !== undefined;

  // Any edit clears the success note. Leaving "Saved" standing over changed
  // fields tells the person their new text is stored when it is not.
  useEffect(() => {
    if (dirty) setSaved(false);
  }, [dirty]);

  const reset = () => {
    setName(organization.name);
    setTimezone(organization.timezone);
    setPhone(organization.phone ?? "");
    setAddress(organization.address ?? "");
    setLogoUploadId(undefined);
    setIssues({});
    setSaved(false);
    mutation.reset();
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();

    const parsed = updateOrganizationSchema.safeParse({
      name,
      timezone,
      phone,
      address,
      ...(logoUploadId === undefined ? {} : { logoUploadId }),
    });

    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "form");
        next[field] ??= issue.message;
      }
      setIssues(next);
      return;
    }

    setIssues({});
    mutation.mutate(parsed.data, {
      onSuccess: () => {
        setSaved(true);
        // The id has done its job: the server now owns the derived URL, and
        // there is no id left to hold.
        setLogoUploadId(undefined);
      },
      onError: (error) => {
        const fields = fieldErrorsFor(error);
        setIssues(
          Object.keys(fields).length > 0 ? fields : { form: error.message },
        );
      },
    });
  };

  const busy = mutation.isPending;
  // `undefined` means unchanged, so the preview is the server's URL; `null`
  // means the person asked for it gone, so the preview goes with it.
  const existingLogo =
    logoUploadId === undefined ? organization.logo : undefined;

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <SettingsPanel
        title="Business logo"
        description="Square, JPEG / PNG / WebP. Shows on receipts and the client project page."
      >
        <div className="flex flex-wrap items-start gap-4">
          {existingLogo ? (
            <div className="flex flex-none flex-col items-start gap-2">
              {/* Not `next/image`: the URL points at whatever object store the
                  API was configured with, and an un-allowlisted remote host is
                  a hard error in the Next image loader rather than a broken
                  thumbnail. */}
              {/* biome-ignore lint/performance/noImgElement: remote host is API-configured, unknown at build time. */}
              <img
                src={existingLogo}
                alt={`${organization.name} logo`}
                className="size-[72px] rounded-xl border border-border object-cover"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setLogoUploadId(null)}
              >
                Remove logo
              </Button>
            </div>
          ) : null}

          {/*
            Every `/uploads` route is gated on `uploads:create` — there is no
            `uploads:view` — so a custom role holding `organization:update`
            without it would otherwise meet a picker whose first request is a
            403. Hidden, not disabled (CLAUDE.md).
          */}
          <PermissionGate permission={PERMISSIONS.UPLOADS_CREATE}>
            <ImagePicker
              purpose="logo"
              max={1}
              value={logoUploadId ? [logoUploadId] : []}
              onChange={(ids) => setLogoUploadId(ids[0] ?? null)}
              disabled={busy}
              className="min-w-[240px] flex-1"
            />
          </PermissionGate>
        </div>

        {issues.logoUploadId ? (
          <p className="text-[13px] text-destructive">{issues.logoUploadId}</p>
        ) : null}
      </SettingsPanel>

      <SettingsPanel>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field
            id={`${uid}-name`}
            label="Business name"
            error={issues.name}
            hint="Shown on receipts. The web address does not change with it."
          >
            {(props) => (
              <input
                {...props}
                value={name}
                disabled={busy}
                maxLength={120}
                autoComplete="organization"
                onChange={(event) => setName(event.target.value)}
                className={CONTROL}
              />
            )}
          </Field>

          <Field
            id={`${uid}-timezone`}
            label="Timezone"
            error={issues.timezone}
            hint="Every report, receipt and daily total is measured in this zone."
          >
            {(props) => (
              <div className="relative">
                <select
                  {...props}
                  value={timezone}
                  disabled={busy}
                  onChange={(event) => setTimezone(event.target.value)}
                  className={SELECT_CONTROL}
                >
                  {/*
                    A zone this runtime could not enumerate but the business is
                    genuinely set to would otherwise vanish from the list and be
                    silently replaced by whatever sorts first.
                  */}
                  {TIMEZONES.includes(timezone) ? null : (
                    <option value={timezone}>{timezone}</option>
                  )}
                  {TIMEZONES.map((zone) => (
                    <option key={zone} value={zone}>
                      {describeTimezone(zone)}
                    </option>
                  ))}
                </select>
                <ChevronGlyph />
              </div>
            )}
          </Field>

          <Field id={`${uid}-phone`} label="Phone" error={issues.phone}>
            {(props) => (
              <input
                {...props}
                value={phone}
                disabled={busy}
                maxLength={40}
                inputMode="tel"
                autoComplete="tel"
                placeholder="+254 720 118 400"
                onChange={(event) => setPhone(event.target.value)}
                className={cn(CONTROL, "font-mono")}
              />
            )}
          </Field>

          <Field id={`${uid}-address`} label="Address" error={issues.address}>
            {(props) => (
              <input
                {...props}
                value={address}
                disabled={busy}
                maxLength={200}
                autoComplete="street-address"
                onChange={(event) => setAddress(event.target.value)}
                className={CONTROL}
              />
            )}
          </Field>
        </div>
      </SettingsPanel>

      {issues.form ? <AlertNote>{issues.form}</AlertNote> : null}
      {saved ? (
        <SuccessNote>Your business details are saved.</SuccessNote>
      ) : null}

      <div className="flex justify-end gap-2.5 border-border border-t pt-4">
        <Button
          type="button"
          variant="outline"
          disabled={busy || !dirty}
          onClick={reset}
        >
          Discard
        </Button>
        <Button type="submit" disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
