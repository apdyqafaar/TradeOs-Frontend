"use client";

import { useId, useState } from "react";
import { ErrorCard } from "@/components/shared/error-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useUpdateAiSettings } from "@/features/organization/hooks/use-organization-mutations";
import { useOrganizationProfile } from "@/features/organization/hooks/use-organization-profile";
import {
  type UpdateAiSettingsInput,
  updateAiSettingsSchema,
} from "@/features/organization/schemas/organization.schema";
import {
  AI_LANGUAGE_LABELS,
  AI_LANGUAGES,
  type AiLanguage,
} from "@/features/organization/types";
import { fieldErrorsFor } from "@/lib/api/errors";
import {
  AlertNote,
  Field,
  InfoNote,
  SELECT_CONTROL,
  SettingsPanel,
  SuccessNote,
} from "./form-primitives";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const twoDigits = (n: number) => String(n).padStart(2, "0");

/** Drops a key instead of storing it, so "changed back" is the same as "unchanged". */
function withoutKey<K extends keyof UpdateAiSettingsInput>(
  draft: UpdateAiSettingsInput,
  key: K,
): UpdateAiSettingsInput {
  const { [key]: _dropped, ...rest } = draft;
  return rest;
}

/**
 * The AI insights settings (Backend spec §4.1).
 *
 * **Only the fields that differ from what the server holds are sent.** The
 * endpoint is a partial PATCH, so posting an unchanged `language` beside a
 * changed `enabled` would be harmless — but it would also make the one log
 * line the server writes per settings change unable to answer "what did they
 * actually change?".
 */
export function AiForm() {
  const profile = useOrganizationProfile();
  const update = useUpdateAiSettings();
  const enabledId = useId();
  const languageId = useId();
  const hourId = useId();
  const [draft, setDraft] = useState<UpdateAiSettingsInput>({});
  const [issue, setIssue] = useState<string | null>(null);

  if (profile.isLoading || !profile.data) {
    return <Skeleton className="h-[280px] rounded-[10px]" />;
  }

  const saved = profile.data.ai;
  const value = { ...saved, ...draft };

  const set = <K extends keyof UpdateAiSettingsInput>(
    key: K,
    next: NonNullable<UpdateAiSettingsInput[K]>,
  ) => {
    setIssue(null);
    setDraft((current) =>
      next === saved[key]
        ? withoutKey(current, key)
        : { ...current, [key]: next },
    );
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = updateAiSettingsSchema.safeParse(draft);
    if (!parsed.success) {
      setIssue(
        parsed.error.issues[0]?.message ?? "Change at least one setting",
      );
      return;
    }
    update.mutate(parsed.data, { onSuccess: () => setDraft({}) });
  };

  const fieldErrors = update.error ? fieldErrorsFor(update.error) : {};
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;

  return (
    <SettingsPanel
      title="AI insights"
      description="Every evening, four analysts read the day's figures and write you a short digest: sales, debts, stock, the team, and what to do tomorrow."
    >
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <Field
          id={enabledId}
          label="Daily digest"
          hint="Generate a digest every evening"
        >
          {(props) => (
            <input
              {...props}
              type="checkbox"
              checked={value.enabled}
              onChange={(event) => set("enabled", event.target.checked)}
              className="size-4 accent-primary"
            />
          )}
        </Field>

        <Field id={languageId} label="Language" error={fieldErrors.language}>
          {(props) => (
            <select
              {...props}
              className={SELECT_CONTROL}
              value={value.language}
              onChange={(event) =>
                set("language", event.target.value as AiLanguage)
              }
            >
              {AI_LANGUAGES.map((code) => (
                <option key={code} value={code}>
                  {AI_LANGUAGE_LABELS[code]}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field
          id={hourId}
          label="Closing hour"
          hint={`In your business timezone, ${profile.data.timezone}.`}
          error={fieldErrors.hourLocal}
        >
          {(props) => (
            <select
              {...props}
              className={SELECT_CONTROL}
              value={String(value.hourLocal)}
              onChange={(event) => set("hourLocal", Number(event.target.value))}
            >
              {HOURS.map((hour) => (
                <option key={hour} value={String(hour)}>
                  {twoDigits(hour)}:00
                </option>
              ))}
            </select>
          )}
        </Field>

        <InfoNote>
          The digest lands under Insights about a minute after the closing hour.
          It reads only your own sales, debts, stock and projects, and customer
          phone numbers are never sent to the model.
        </InfoNote>

        {issue ? <AlertNote>{issue}</AlertNote> : null}
        {update.error && !hasFieldErrors ? (
          <ErrorCard error={update.error} />
        ) : null}
        {!issue && update.isSuccess && Object.keys(draft).length === 0 ? (
          <SuccessNote>Saved.</SuccessNote>
        ) : null}

        <div className="flex justify-end">
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </SettingsPanel>
  );
}
