"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { type ReactNode, useEffect } from "react";
import { type UseFormReturn, useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  useCreateCustomer,
  useUpdateCustomer,
} from "@/features/customers/hooks/use-customer-mutations";
import {
  type CreateCustomerInput,
  CUSTOMER_CONFLICT_FIELDS,
  createCustomerSchema,
  type UpdateCustomerInput,
  updateCustomerSchema,
} from "@/features/customers/schemas/customer.schema";
import type { Customer } from "@/features/customers/types";
import type { ApiError } from "@/lib/api/errors";
import { API_ERROR_CODE, fieldErrorsFor, hasCode } from "@/lib/api/errors";

/**
 * The five controls the sheet owns, and the only keys a 422 may be written on
 * to. A `status` error — which `PATCH /customers/:id` can raise — has no
 * control here and falls through to the banner, which is the honest place for
 * it.
 */
const FIELDS = ["name", "phone", "email", "address", "notes"] as const;

interface CustomerFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Fires with the created row, and **only** on a create.
   *
   * Slice 3's counter is the reason this exists: its quick-create has to select
   * the new customer the instant the server confirms them, and it is handed the
   * `Customer` rather than an id so it never has to re-fetch a row it was just
   * given. The sheet closes itself either way — a caller that only needs the
   * list refreshed can omit this entirely, because `useCreateCustomer` has
   * already invalidated every list.
   */
  onCreated?: (customer: Customer) => void;
  /**
   * Present ⇒ edit mode. Task 9's detail page opens the sheet this way.
   *
   * Absent ⇒ create mode. Nothing else changes shape: the same five controls,
   * the same validation, a different verb and a different endpoint.
   */
  customer?: Customer;
}

/**
 * Form state ← a customer, or ← nothing.
 *
 * Every field is a string even where the type says optional, because an
 * `undefined` in `defaultValues` makes the input uncontrolled on the first
 * render and controlled on the first keystroke, which React warns about once
 * and then silently loses the value it was warned about.
 */
function toFormValues(customer?: Customer): CreateCustomerInput {
  return {
    name: customer?.name ?? "",
    phone: customer?.phone ?? "",
    email: customer?.email ?? "",
    address: customer?.address ?? "",
    notes: customer?.notes ?? "",
  };
}

/**
 * The quick-create sheet of artboard `2h`, and the edit sheet behind Task 9's
 * detail page — one component, because they are the same five fields under the
 * same rules and a second copy would drift.
 *
 * **It is self-contained on purpose.** It reads no filters, no route params and
 * no page-level context, gates on no permission of its own, and owns its whole
 * lifecycle through `open` / `onOpenChange`. That is what lets the counter
 * mount it beside a cart in Slice 3 without dragging the customers page along.
 *
 * `mutate` with per-call `{ onSuccess, onError }` rather than `mutateAsync` in a
 * `try`/`catch`: the caller's `onCreated` has to run on the same tick the
 * server answers, and the pending flag the button reads is the mutation's own
 * `isPending` rather than `formState.isSubmitting`, which a fire-and-forget
 * `mutate` never sets.
 */
export function CustomerFormSheet({
  open,
  onOpenChange,
  onCreated,
  customer,
}: CustomerFormSheetProps) {
  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer();
  const isEdit = customer !== undefined;

  /*
   * `createCustomerSchema` validates both modes, including the edit one.
   *
   * The sheet always shows all five controls filled from the row, so what the
   * user is looking at is a complete customer and the create schema's rules —
   * name required, phone required, the same bounds — are exactly the right
   * ones. `updateCustomerSchema` differs only in making every field optional
   * (which nothing here needs), adding `status` (which this form never sets)
   * and refusing an empty body; that last rule is real, so it is applied below
   * to the PATCH body it is actually about, rather than to the form.
   */
  const form = useForm<CreateCustomerInput>({
    resolver: zodResolver(createCustomerSchema),
    defaultValues: toFormValues(customer),
  });

  /*
   * A closed sheet stays mounted — the counter keeps one beside its cart — so
   * `defaultValues` is only ever read once. Re-seeding on each open is what
   * makes the second quick-create start empty instead of holding the first
   * one's typing, and what makes "edit Bakaara, cancel, edit Faisal" show
   * Faisal.
   *
   * The guard is `if (open)`, so a reset only ever happens on the way in and
   * never over somebody's typing.
   *
   * **Pass a stable `customer`** — the row out of React Query's cache, not one
   * rebuilt inline in the parent's render. The prop is in the dependency list
   * because that is what makes "edit Bakaara, then edit Faisal" show Faisal,
   * and a fresh object identity on every parent render would re-run this while
   * the sheet is open.
   */
  useEffect(() => {
    if (open) form.reset(toFormValues(customer));
  }, [open, customer, form.reset]);

  const close = () => onOpenChange(false);

  /*
   * Both read during render. `formState` is a proxy whose getters register what
   * this component is subscribed to, and a slice read for the first time inside
   * a callback is never subscribed — so the form would not re-render as fields
   * become dirty. Reading them here is react-hook-form's own documented
   * pattern, rather than leaning on the internal that keeps
   * `_formState.dirtyFields` current for an unsubscribed read.
   */
  const { errors, dirtyFields } = form.formState;

  /*
   * Nothing clears the banner at the top of this handler, and nothing needs to:
   * `handleSubmit` runs `unset(_formState.errors, ROOT_ERROR_TYPE)` on every
   * submit *before* it decides whether to call the callback — verified in
   * `react-hook-form/src/logic/createFormControl.ts` via the published source
   * map. So a `root.serverError` set below lives exactly until the next
   * attempt, which is the wanted lifetime; clearing it by hand would be a line
   * that never does anything.
   */
  const onSubmit = form.handleSubmit((values) => {
    const onError = (error: ApiError) => applyServerError(error, form);

    if (!customer) {
      /*
       * `values` is the schema's *output*: trimmed, the email lower-cased or
       * dropped when blank. `address` and `notes` still arrive as `""` when
       * untouched, because the schema deliberately lets `""` through so a PATCH
       * can clear them — on a create there is nothing to clear, so a blank is
       * an omitted field rather than a stored empty string.
       */
      const input: CreateCustomerInput = {
        name: values.name,
        phone: values.phone,
        ...(values.email ? { email: values.email } : {}),
        ...(values.address ? { address: values.address } : {}),
        ...(values.notes ? { notes: values.notes } : {}),
      };

      createCustomer.mutate(input, {
        onSuccess: (created) => {
          onCreated?.(created);
          close();
        },
        onError,
      });
      return;
    }

    /*
     * PATCH means "change what I sent", so only what the user touched is sent.
     * A full body would re-send four fields nobody edited, which is how one
     * tab's stale value silently overwrites another's edit.
     */
    const input: UpdateCustomerInput = {};
    if (dirtyFields.name) input.name = values.name;
    if (dirtyFields.phone) input.phone = values.phone;
    if (dirtyFields.address) input.address = values.address;
    if (dirtyFields.notes) input.notes = values.notes;

    if (dirtyFields.email) {
      if (values.email) {
        input.email = values.email;
      } else {
        /*
         * The user emptied an email that was set, and the API has no way to
         * express that: its `email` rule is `.email()`, so `""` is a 422 and an
         * omitted key means "leave it alone". Dropping the change silently
         * would close the sheet on an edit that did not happen, so it is said
         * out loud instead. See `docs/findings/s2-task-03.md`.
         */
        form.setError("email", {
          type: "manual",
          message: "An email can't be removed once it is set.",
        });
        return;
      }
    }

    // The backend refuses an empty body with "Nothing to update";
    // `updateCustomerSchema`'s refinement mirrors it, so the round trip is
    // spared and the message is the schema's rather than one invented here.
    const parsed = updateCustomerSchema.safeParse(input);
    if (!parsed.success) {
      form.setError("root.serverError", {
        type: "manual",
        message: parsed.error.issues[0]?.message ?? "Nothing has changed",
      });
      return;
    }

    updateCustomer.mutate(
      { id: customer.id, input: parsed.data },
      { onSuccess: close, onError },
    );
  });

  const isPending = createCustomer.isPending || updateCustomer.isPending;
  const rootError = errors.root?.serverError?.message;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        // `w-full!` and `sm:max-w-[440px]!`, both with `!`: `SheetContent`'s own
        // `data-[side=right]:w-3/4` and `data-[side=right]:sm:max-w-sm` carry an
        // attribute selector, so they outrank a plain width utility and the
        // sheet would be 384px rather than the canvas's 440px.
        className="w-full! gap-0 p-0 sm:max-w-[440px]!"
      >
        <form
          noValidate
          onSubmit={onSubmit}
          className="flex h-full flex-col overflow-y-auto"
        >
          <SheetHeader className="gap-1.5 p-6 pb-4">
            <SheetTitle className="font-serif text-2xl font-normal leading-tight">
              {isEdit ? "Edit customer" : "New customer"}
            </SheetTitle>
            {/* The canvas's subtitle here is a note to the reader of the design
                ("The same sheet opens from the counter"), not something to say
                to a shopkeeper. The dialog still needs a description, so it
                gets one that tells them what the form wants. */}
            <SheetDescription className="text-[13px]">
              {isEdit
                ? "Change what this customer's record says."
                : "A name and a phone number are all this needs."}
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-1 flex-col gap-4 px-6 pb-6">
            {/* The banner is the last resort, not the first: `applyServerError`
                only reaches it when no control claimed the failure. A form
                showing a banner and a field message for one refusal reads as
                two problems. */}
            {rootError ? (
              <p
                role="alert"
                className="rounded-[10px] border border-destructive/40 bg-destructive-soft px-3 py-2 text-[13px] text-destructive-strong"
              >
                {rootError}
              </p>
            ) : null}

            <Field
              label="Name"
              htmlFor="customer-name"
              error={errors.name?.message}
            >
              <Input
                {...form.register("name")}
                id="customer-name"
                autoComplete="off"
                aria-invalid={errors.name ? true : undefined}
                className="h-11 rounded-[10px] bg-background dark:bg-background"
              />
            </Field>

            <Field
              label="Phone"
              htmlFor="customer-phone"
              error={errors.phone?.message}
            >
              {/*
                Required, and the field a `DUPLICATE_PHONE` 409 lands on. Mono
                because the value is read digit by digit, and `type="tel"` so a
                phone shows the keypad — not `type="number"`, which strips the
                leading `+` this market's numbers carry.
              */}
              <Input
                {...form.register("phone")}
                id="customer-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                aria-invalid={errors.phone ? true : undefined}
                className="h-11 rounded-[10px] bg-background font-mono dark:bg-background"
              />
            </Field>

            <Field
              label="Email"
              optional
              htmlFor="customer-email"
              error={errors.email?.message}
            >
              <Input
                {...form.register("email")}
                id="customer-email"
                type="email"
                autoComplete="email"
                placeholder="name@example.com"
                aria-invalid={errors.email ? true : undefined}
                className="h-11 rounded-[10px] bg-background dark:bg-background"
              />
            </Field>

            <Field
              label="Address"
              optional
              htmlFor="customer-address"
              error={errors.address?.message}
            >
              <Input
                {...form.register("address")}
                id="customer-address"
                autoComplete="street-address"
                placeholder="Street, city"
                aria-invalid={errors.address ? true : undefined}
                className="h-11 rounded-[10px] bg-background dark:bg-background"
              />
            </Field>

            <Field
              label="Notes"
              optional
              htmlFor="customer-notes"
              error={errors.notes?.message}
            >
              {/* A plain `<textarea>`: `components/ui/` is vendored shadcn and
                  has no Textarea, and hand-adding one there is exactly what
                  `CLAUDE.md` forbids. The classes mirror `<Input>`'s. */}
              <textarea
                {...form.register("notes")}
                id="customer-notes"
                rows={3}
                placeholder="Buys in bulk on Fridays"
                aria-invalid={errors.notes ? true : undefined}
                className="min-h-16 w-full rounded-[10px] border border-input bg-background px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
              />
            </Field>
          </div>

          <div className="flex justify-end gap-2.5 border-t border-border px-6 py-4">
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={close}
              className="h-10 rounded-[10px] px-4 text-[13px]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="h-10 rounded-[10px] px-4 text-[13px]"
            >
              {isPending ? "Saving…" : "Save customer"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/**
 * An `ApiError` turned into something the user can act on, in priority order:
 * the field the API said is wrong, then the field the conflict is about, then
 * one banner. Every branch is on `code` or on the structured `errors` map —
 * never on `message`.
 */
function applyServerError(
  error: ApiError,
  form: UseFormReturn<CreateCustomerInput>,
): void {
  // 422 — `errors: { field: message }` straight from the backend's validate
  // middleware. The common case, and the only fully automatic one.
  const fieldErrors = fieldErrorsFor(error);
  let placed = false;
  for (const field of FIELDS) {
    const message = fieldErrors[field];
    if (message) {
      form.setError(field, { type: "server", message });
      placed = true;
    }
  }
  // Nothing matched means the form and the endpoint disagree about the body.
  // Fall through to the banner rather than swallowing it, which would leave a
  // form that refuses to submit and says nothing.
  if (placed) return;

  /*
   * 409 — `DUPLICATE_PHONE`, on the phone box.
   *
   * Not a banner: the caller typed a number another customer already holds and
   * the only thing they can do about it is change that one control, so the
   * message belongs where they are already looking. It can fire on a number
   * this form has never seen, because the index compares the *normalised*
   * value — `0712 345 678` collides with a stored `0712-345-678`.
   */
  const conflictFields: Partial<Record<string, keyof CreateCustomerInput>> =
    CUSTOMER_CONFLICT_FIELDS;
  const conflictField = error.code ? conflictFields[error.code] : undefined;
  if (conflictField) {
    form.setError(conflictField, { type: "server", message: error.message });
    return;
  }

  // 403 — the button should not have been reachable. Say so plainly rather
  // than in the API's phrasing, which is written for a developer.
  if (hasCode(error, API_ERROR_CODE.FORBIDDEN)) {
    form.setError("root.serverError", {
      type: "server",
      message: "You don't have permission to do this.",
    });
    return;
  }

  form.setError("root.serverError", { type: "server", message: error.message });
}

/** Label, control, message — so no field can ship without its error slot. */
function Field({
  label,
  optional,
  htmlFor,
  error,
  children,
}: {
  label: string;
  /** Renders the canvas's muted "optional" beside the label. */
  optional?: boolean;
  htmlFor: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor} className="gap-1.5 text-[13px]">
        {label}
        {optional ? (
          <span className="font-normal text-muted-foreground text-xs">
            optional
          </span>
        ) : null}
      </Label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
