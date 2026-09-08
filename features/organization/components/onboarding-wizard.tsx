"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/config/routes";
import { useSession } from "@/features/auth/hooks/use-session";
import { authKeys } from "@/features/auth/keys";
import { useCreateOrganization } from "@/features/organization/hooks/use-create-organization";
import type { CreateOrganizationInput } from "@/features/organization/schemas/organization.schema";
import { createOrganizationSchema } from "@/features/organization/schemas/organization.schema";
import {
  API_ERROR_CODE,
  type ApiError,
  fieldErrorsFor,
} from "@/lib/api/errors";
import { StepBusiness } from "./step-business";
import { StepCurrency } from "./step-currency";
import { emptyInviteRow, type InviteRow, StepInvite } from "./step-invite";

/**
 * Three steps, one request.
 *
 * `POST /organizations` takes name, timezone, mainCurrency, exchangeCurrency
 * and exchangeRate **together** — the handler writes the Organization, its
 * CurrencyConfig, the owner Member and the default categories in a single
 * transaction, and there is no partial create to come back to. So the wizard
 * is presentation over one `useForm`: each step validates its own fields
 * before advancing, and the whole payload is submitted once at the end.
 */

const STEPS = ["Business", "Currency", "Team"] as const;

/** Which fields each step owns, for the `trigger` that gates advancing. */
const STEP_FIELDS: readonly (readonly (keyof CreateOrganizationInput)[])[] = [
  ["name", "timezone"],
  ["mainCurrency", "exchangeCurrency", "exchangeRate"],
  [],
];

const HEADINGS = [
  {
    title: "Create your business",
    subtitle: "The name your customers and your staff will see.",
  },
  {
    title: "How you price things",
    subtitle: "Every total in TradeOs is in your main currency.",
  },
  {
    title: "Who else works here",
    subtitle: "Optional — you can invite your team whenever you like.",
  },
] as const;

/**
 * The browser's zone as the starting guess, because it is right far more often
 * than it is wrong and it is one field the owner then does not have to think
 * about. `Intl` can answer `undefined` on an engine with no zone configured,
 * hence the fallback — an empty timezone fails the schema's `min(1)`.
 */
const browserTimezone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/**
 * The banner sentence for a failure that did not land on a field.
 *
 * Branches on `code`, never on `message` — but *renders* the API's message in
 * the general case, which is a different thing: the two 409s this endpoint can
 * answer with ("you already belong to a business" and "that name is already
 * registered") share the CONFLICT code and are told apart only by their
 * sentence, which the backend writes for exactly this purpose.
 */
const bannerFor = (error: ApiError | null): string | null => {
  if (!error) return null;
  // A 422 that mapped onto fields is already shown at the fields.
  if (Object.keys(fieldErrorsFor(error)).length > 0) return null;

  if (error.code === API_ERROR_CODE.EMAIL_NOT_VERIFIED) {
    return "Your email still isn't confirmed, so this business can't be created yet.";
  }
  if (error.code === API_ERROR_CODE.TOO_MANY_REQUESTS) {
    return "Too many attempts — try again in a few minutes.";
  }
  return error.message;
};

export interface OnboardingWizardProps {
  /**
   * `POST /organizations` sits behind `requireVerifiedEmail`. Without this
   * gate the owner fills in three steps and is refused by a 403 at the end,
   * which is the worst possible moment to learn it.
   */
  emailVerified: boolean;
}

export function OnboardingWizard({ emailVerified }: OnboardingWizardProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { mutate, isPending, error } = useCreateOrganization();

  const [step, setStep] = useState(0);
  const [invites, setInvites] = useState<InviteRow[]>([emptyInviteRow()]);

  const form = useForm<CreateOrganizationInput>({
    resolver: zodResolver(createOrganizationSchema),
    mode: "onTouched",
    defaultValues: {
      name: "",
      timezone: browserTimezone(),
      mainCurrency: "",
      exchangeCurrency: "",
      // `undefined`, not 0: 0 is a value the schema rejects, so a pristine form
      // would open showing "must be greater than zero" against a field the
      // owner has not reached yet.
      exchangeRate: undefined as unknown as number,
    },
  });
  // Read through the proxy here, in the component that owns `useForm`, so the
  // subscription is registered where re-renders happen. A step that read
  // `form.formState.errors` itself would never re-render when they changed.
  const { errors } = form.formState;

  const isLastStep = step === STEPS.length - 1;
  const banner = bannerFor(error);

  const advance = async () => {
    const fields = STEP_FIELDS[step] ?? [];
    if (fields.length > 0 && !(await form.trigger([...fields]))) return;
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  };

  const submit = form.handleSubmit((values) => {
    mutate(values, {
      onSuccess: () => {
        // TODO(slice: members): send `invites` through POST /members/invite,
        // one request per row, once the members slice exists. They are
        // collected here and deliberately dropped — the endpoint is gated on a
        // verified email of its own and belongs to a later plan, and a wizard
        // that silently failed to invite anyone would be worse than one that
        // never promised to.
        router.push(ROUTES.overview);
      },
      onError: (failure) => {
        // A 422 belongs at the field the owner has to change, not in a banner
        // above three collapsed steps.
        for (const [field, message] of Object.entries(
          fieldErrorsFor(failure),
        )) {
          if (field in values) {
            form.setError(field as keyof CreateOrganizationInput, { message });
          }
        }
        // Send them back to the step that owns the first rejected field.
        const rejected = Object.keys(fieldErrorsFor(failure));
        const target = STEP_FIELDS.findIndex((fields) =>
          fields.some((field) => rejected.includes(field)),
        );
        if (target >= 0) setStep(target);
      },
    });
  });

  return (
    <div className="flex flex-col gap-[22px]">
      <div aria-hidden="true" className="flex gap-1.5">
        {STEPS.map((label, index) => (
          <span
            className={`h-[3px] flex-1 rounded-full ${
              index <= step ? "bg-primary" : "bg-border"
            }`}
            key={label}
          />
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <p className="font-medium font-mono text-[11px] text-muted-2 uppercase tracking-[0.08em]">
          Step {step + 1} of {STEPS.length} · {STEPS[step]}
        </p>
        <h1 className="font-serif text-[36px] leading-[1.08] tracking-tight">
          {HEADINGS[step]?.title}
        </h1>
        <p className="text-muted-foreground text-sm">
          {HEADINGS[step]?.subtitle}
        </p>
      </div>

      {/* No `role="status"` on the notice below: it is painted with the page
          rather than announced when something changes, and a live region that
          fires on first paint reads the whole thing over whatever the user was
          already doing. */}
      {emailVerified ? null : (
        <div className="flex items-start gap-2.5 rounded-[10px] border border-warning/40 bg-warning-soft px-3.5 py-3">
          <TriangleAlert className="mt-px size-4 shrink-0 text-warning" />
          <div className="flex flex-col items-start gap-1.5">
            <p className="text-[13px] text-warning-strong">
              Verify your email before creating a business.
            </p>
            <p className="text-[12px] text-warning-strong/80">
              Open the link we sent to your inbox — a business is a name other
              people transact under, so TradeOs confirms the address first.
            </p>
            <button
              className="font-medium text-[13px] text-warning underline underline-offset-2"
              onClick={() => {
                // The link was opened in another tab or on a phone; nothing
                // tells this page so. Re-reading the session is the whole fix.
                void queryClient.invalidateQueries({
                  queryKey: authKeys.session(),
                });
              }}
              type="button"
            >
              I've confirmed it — check again
            </button>
          </div>
        </div>
      )}

      {banner ? (
        <div
          className="flex items-start gap-2.5 rounded-[10px] border border-destructive/40 bg-destructive/12 px-3.5 py-3"
          role="alert"
        >
          <TriangleAlert className="mt-px size-4 shrink-0 text-destructive" />
          <div className="flex flex-col gap-1">
            <p className="text-[13px]">{banner}</p>
            {error?.requestId ? (
              <p className="font-mono text-[11px] text-muted-3">
                Request ID: {error.requestId}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <form
        className="flex flex-col gap-[22px]"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (isLastStep) {
            void submit(event);
            return;
          }
          void advance();
        }}
      >
        {/* One disabled `<fieldset>` rather than a `disabled` on each control:
            it covers whatever a step renders, including anything added later.
            `display: contents` keeps it out of the layout. */}
        <fieldset className="contents" disabled={!emailVerified}>
          {step === 0 ? (
            <StepBusiness
              disabled={!emailVerified}
              errors={errors}
              register={form.register}
            />
          ) : null}
          {step === 1 ? (
            <StepCurrency
              control={form.control}
              errors={errors}
              register={form.register}
            />
          ) : null}
          {step === 2 ? (
            <StepInvite onChange={setInvites} rows={invites} />
          ) : null}
        </fieldset>

        <div className="flex flex-col gap-2">
          <Button
            className="h-11 w-full rounded-[10px]"
            disabled={!emailVerified || isPending}
            type="submit"
          >
            {isLastStep ? "Create business" : "Continue"}
          </Button>
          {step > 0 ? (
            <Button
              className="h-9 w-full rounded-[10px]"
              disabled={isPending}
              onClick={() => setStep((current) => Math.max(current - 1, 0))}
              type="button"
              variant="ghost"
            >
              Back
            </Button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

/**
 * The screen the route renders: the same wizard, told whether the signed-in
 * person's address is confirmed.
 *
 * Split from `OnboardingWizard` so the wizard itself takes `emailVerified` as
 * a plain prop — both of its states are then one render apart in a test,
 * instead of needing a seeded session cache.
 */
export function OnboardingScreen() {
  const session = useSession();

  if (session.isPending) {
    return (
      <div className="flex flex-col gap-[22px]">
        <Skeleton className="h-[3px] w-full" />
        <Skeleton className="h-[44px] w-3/4" />
        <Skeleton className="h-[88px] w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  }

  return (
    <OnboardingWizard
      emailVerified={session.data?.user.emailVerified ?? false}
    />
  );
}
