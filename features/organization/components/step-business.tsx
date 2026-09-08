"use client";

import type { FieldErrors, UseFormRegister } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CreateOrganizationInput } from "@/features/organization/schemas/organization.schema";

/**
 * Step 1 of onboarding: what the business is called and where its day starts.
 *
 * Presentational only. It holds no state and calls no hook of its own — the
 * wizard owns the single `useForm`, because `POST /organizations` has no
 * partial create and the whole payload is submitted once at the end.
 */
export interface StepBusinessProps {
  register: UseFormRegister<CreateOrganizationInput>;
  errors: FieldErrors<CreateOrganizationInput>;
  /** True while the email is unverified: the fields are shown, not hidden. */
  disabled?: boolean;
}

/**
 * Every IANA zone the runtime knows (418 of them on Node 20), offered through
 * a `<datalist>` rather than a `<select>`.
 *
 * A native datalist gives substring search for free — typing "nair" finds
 * `Africa/Nairobi` — with no combobox to build, no listbox keyboard model to
 * get wrong, and no 418-option select to scroll. The trade is that the field
 * accepts free text, which is the right trade here: the backend takes any
 * 1–100 character string, so a zone this build's `Intl` has not heard of is
 * still a legal answer rather than one the UI refuses.
 *
 * Guarded because `Intl.supportedValuesOf` is ES2022: an engine without it
 * gets a plain text field pre-filled with its own zone, which still works.
 */
const timezoneOptions = (): string[] => {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
};

export function StepBusiness({
  register,
  errors,
  disabled,
}: StepBusinessProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-[7px]">
        <Label htmlFor="onboarding-name">Business name</Label>
        <Input
          id="onboarding-name"
          autoComplete="organization"
          className="h-11 rounded-[10px] bg-card"
          disabled={disabled}
          placeholder="Spark Trading Ltd"
          {...register("name")}
          aria-describedby={errors.name ? "onboarding-name-error" : undefined}
          aria-invalid={errors.name ? true : undefined}
        />
        <p className="text-[12px] text-muted-3">
          This is the name on receipts and on invitations to your staff.
        </p>
        {errors.name ? (
          <p
            className="text-[13px] text-destructive"
            id="onboarding-name-error"
          >
            {errors.name.message}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-[7px]">
        <Label htmlFor="onboarding-timezone">Timezone</Label>
        <Input
          id="onboarding-timezone"
          className="h-11 rounded-[10px] bg-card"
          disabled={disabled}
          list="onboarding-timezone-options"
          placeholder="Africa/Nairobi"
          {...register("timezone")}
          aria-describedby={
            errors.timezone ? "onboarding-timezone-error" : undefined
          }
          aria-invalid={errors.timezone ? true : undefined}
        />
        <datalist id="onboarding-timezone-options">
          {timezoneOptions().map((zone) => (
            <option key={zone} value={zone} />
          ))}
        </datalist>
        <p className="text-[12px] text-muted-3">
          Your reports and receipts use this zone, not your browser's.
        </p>
        {errors.timezone ? (
          <p
            className="text-[13px] text-destructive"
            id="onboarding-timezone-error"
          >
            {errors.timezone.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
