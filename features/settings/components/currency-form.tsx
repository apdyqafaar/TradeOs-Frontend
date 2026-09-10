"use client";

import { cn } from "cn";
import { useEffect, useId, useState } from "react";
import { ErrorCard } from "@/components/shared/error-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrencyConfig } from "@/features/organization/hooks/use-currency-config";
import { useUpdateCurrencyConfig } from "@/features/organization/hooks/use-organization-mutations";
import { ensureCurrencyOption } from "@/features/organization/lib/currencies";
import { updateCurrencySchema } from "@/features/organization/schemas/organization.schema";
import { fieldErrorsFor } from "@/lib/api/errors";
import {
  AlertNote,
  ChevronGlyph,
  CONTROL,
  Field,
  InfoNote,
  SELECT_CONTROL,
  SettingsPanel,
  SuccessNote,
} from "./form-primitives";

/**
 * The Currency tab of `/settings` — artboard `2k`
 * (`docs/design/TradeOs-UI.dc.html:1360-1375`): main currency, exchange
 * currency, rate, the plain-language rate line, and the note about existing
 * records.
 *
 * ## The three things this form exists to get right
 *
 * **The rate direction.** `exchangeRate` is *units of MAIN per one unit of
 * EXCHANGE*, confirmed three independent ways in the contract §8:
 * `currency-config.model.ts:9`, `toMain(amount, rate) = round2(amount * rate)`
 * in `Backend/src/lib/money.ts:24-28`, and `resolveRate` in
 * `debt.service.ts:32-33` / `sale.service.ts:57`, whose callers multiply. So
 * the label is `1 <exchange> = ___ <main>` and never the reverse. This repo has
 * already shipped that inversion once (`docs/FINDINGS.md`, "Money direction"),
 * and inverting it misprices every converted amount on the platform.
 *
 * **The two codes must differ, and only this form enforces it.** Nothing
 * upstream compares them — `updateCurrencySchema` on the API accepts
 * `{ mainCurrency: "USD", exchangeCurrency: "USD" }` (contract §3, run against
 * the real validator). The damage is silent: `resolveRate` tests
 * `currency === config.mainCurrency` **first**, so with both set the same,
 * every amount resolves at rate 1 and the rate on this screen becomes data no
 * sale, payment or debt will ever apply. The refinement lives in
 * `updateCurrencySchema` here, and the message says why rather than just
 * refusing.
 *
 * **All three fields go together.** A one-field PATCH is legal upstream and is
 * exactly what breaks the pair: `{ mainCurrency: "KES" }` leaves the exchange
 * currency and rate describing the currency that *used* to be main, with no
 * recalculation of anything. Submitting the triple is what makes that
 * unreachable.
 */
export function CurrencyForm() {
  const config = useCurrencyConfig();

  if (config.isLoading) {
    return <Skeleton className="h-[280px] rounded-[10px]" />;
  }

  // `useCurrencyConfig` narrows to the four values the counter needs and drops
  // the query's own error, which is right for the twenty screens that only
  // format money with it — but this screen is the one that must say when the
  // config could not be read at all, rather than rendering a form seeded with
  // empty codes and a zero rate that Save would then write.
  if (config.mainCurrency === "" || config.exchangeCurrency === "") {
    return (
      <ErrorCard
        error={{
          message:
            "Your currency configuration could not be read. It is created with the business, so this is worth reporting rather than re-entering.",
        }}
        title="Couldn't load your currency"
      />
    );
  }

  return (
    <CurrencyFields
      key={`${config.mainCurrency}-${config.exchangeCurrency}-${config.exchangeRate}`}
      mainCurrency={config.mainCurrency}
      exchangeCurrency={config.exchangeCurrency}
      exchangeRate={config.exchangeRate}
    />
  );
}

function CurrencyFields({
  mainCurrency: savedMain,
  exchangeCurrency: savedExchange,
  exchangeRate: savedRate,
}: {
  mainCurrency: string;
  exchangeCurrency: string;
  exchangeRate: number;
}) {
  const uid = useId();
  const mutation = useUpdateCurrencyConfig();

  const [main, setMain] = useState(savedMain);
  const [exchange, setExchange] = useState(savedExchange);
  /**
   * Held as the typed string, converted once at submit.
   *
   * `exchangeRate` must reach the API as a JSON **number** — `"600"` is a 422
   * (contract §3) — but storing a `number` in state makes a half-typed `"0."`
   * or an emptied field unrepresentable, and `valueAsNumber` on an empty input
   * is `NaN`. So the string is the source of truth and `Number()` runs once,
   * where the schema can reject the result.
   */
  const [rate, setRate] = useState(String(savedRate));
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const dirty =
    main !== savedMain ||
    exchange !== savedExchange ||
    rate.trim() !== String(savedRate);

  useEffect(() => {
    if (dirty) setSaved(false);
  }, [dirty]);

  const reset = () => {
    setMain(savedMain);
    setExchange(savedExchange);
    setRate(String(savedRate));
    setIssues({});
    setSaved(false);
    mutation.reset();
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();

    const parsed = updateCurrencySchema.safeParse({
      mainCurrency: main,
      exchangeCurrency: exchange,
      // An empty field is `NaN` here, which fails `z.number()`'s own type check
      // before `.positive()` runs — hence the custom `error` on the schema's
      // `z.number()`, so the message reads "Exchange rate is required" rather
      // than "expected number, received NaN".
      exchangeRate: rate.trim() === "" ? Number.NaN : Number(rate),
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
      onSuccess: () => setSaved(true),
      onError: (error) => {
        const fields = fieldErrorsFor(error);
        setIssues(
          Object.keys(fields).length > 0 ? fields : { form: error.message },
        );
      },
    });
  };

  const busy = mutation.isPending;

  // Whatever the business already uses stays selectable even when the curated
  // catalog does not list it — otherwise opening this tab on an unlisted code
  // would show an empty select, and saving the triple would overwrite a working
  // configuration with whatever sorts first.
  const mainOptions = ensureCurrencyOption(savedMain);
  const exchangeOptions = ensureCurrencyOption(savedExchange);

  const rateNumber = Number(rate);
  const ratePreview =
    rate.trim() !== "" &&
    Number.isFinite(rateNumber) &&
    rateNumber > 0 &&
    main !== "" &&
    exchange !== "" &&
    main !== exchange
      ? `1 ${exchange} = ${new Intl.NumberFormat("en-US", {
          maximumFractionDigits: 6,
        }).format(rateNumber)} ${main}`
      : null;

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <SettingsPanel>
        <div className="grid gap-3.5 sm:grid-cols-3">
          <Field
            id={`${uid}-main`}
            label="Main currency"
            error={issues.mainCurrency}
          >
            {(props) => (
              <div className="relative">
                <select
                  {...props}
                  value={main}
                  disabled={busy}
                  onChange={(event) => setMain(event.target.value)}
                  className={cn(SELECT_CONTROL, "font-mono")}
                >
                  {mainOptions.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.code} — {option.name}
                    </option>
                  ))}
                </select>
                <ChevronGlyph />
              </div>
            )}
          </Field>

          <Field
            id={`${uid}-exchange`}
            label="Exchange currency"
            error={issues.exchangeCurrency}
          >
            {(props) => (
              <div className="relative">
                <select
                  {...props}
                  value={exchange}
                  disabled={busy}
                  onChange={(event) => setExchange(event.target.value)}
                  className={cn(SELECT_CONTROL, "font-mono")}
                >
                  {exchangeOptions.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.code} — {option.name}
                    </option>
                  ))}
                </select>
                <ChevronGlyph />
              </div>
            )}
          </Field>

          <Field
            id={`${uid}-rate`}
            label={`Rate — 1 ${exchange || "exchange"} in ${main || "main"}`}
            error={issues.exchangeRate}
          >
            {(props) => (
              <input
                {...props}
                // `inputMode="decimal"` rather than `type="number"`: a number
                // input's spinner and locale-dependent parsing are both wrong
                // for a rate that can be 0.0077, and the string is converted
                // explicitly at submit anyway.
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={rate}
                disabled={busy}
                onChange={(event) => setRate(event.target.value)}
                className={cn(CONTROL, "font-mono")}
              />
            )}
          </Field>
        </div>

        {/*
          The plain-language reading of the stored direction. It is the one
          sentence on this screen an owner will check against what they know:
          "1 USD = 130 KES" for main KES, exchange USD, rate 130.
        */}
        {ratePreview ? (
          <p className="font-mono text-[13px] text-foreground">{ratePreview}</p>
        ) : null}

        <InfoNote>
          Changing the rate affects new sales and payments only; existing
          records keep the rate they were made at.
        </InfoNote>
      </SettingsPanel>

      {issues.form ? <AlertNote>{issues.form}</AlertNote> : null}
      {saved ? (
        <SuccessNote>Your currency settings are saved.</SuccessNote>
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
