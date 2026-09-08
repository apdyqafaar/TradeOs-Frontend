"use client";

import {
  type Control,
  type FieldErrors,
  type UseFormRegister,
  useWatch,
} from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CreateOrganizationInput } from "@/features/organization/schemas/organization.schema";

/**
 * Step 2 of onboarding: the two currencies and the rate between them.
 *
 * This is a wizard step rather than a Settings field because
 * `POST /organizations` writes the Organization and its CurrencyConfig in one
 * transaction and refuses a body missing either currency or the rate — there
 * is no partial create to come back and finish later.
 */
export interface StepCurrencyProps {
  register: UseFormRegister<CreateOrganizationInput>;
  control: Control<CreateOrganizationInput>;
  errors: FieldErrors<CreateOrganizationInput>;
}

/**
 * Suggestions, not a whitelist. Offered through a `<datalist>` so the field
 * still accepts any ISO 4217 code — the backend takes any three letters, and a
 * `<select>` here would refuse a legal currency this list forgot.
 */
const COMMON_CURRENCIES = [
  "KES",
  "USD",
  "EUR",
  "GBP",
  "TZS",
  "UGX",
  "SOS",
  "ETB",
  "DJF",
  "RWF",
  "AED",
  "SAR",
  "ZAR",
  "NGN",
  "GHS",
  "EGP",
  "INR",
  "CNY",
  "TRY",
];

export function StepCurrency({ register, control, errors }: StepCurrencyProps) {
  const [mainCurrency, exchangeCurrency, exchangeRate] = useWatch({
    control,
    name: ["mainCurrency", "exchangeCurrency", "exchangeRate"],
  });

  /**
   * `exchangeRate` is **units of MAIN per one unit of EXCHANGE** — that is what
   * `toMain(amount, rate)` in `Backend/src/lib/money.ts` multiplies by, and it
   * is the direction the whole backend stores. So the sentence reads from the
   * exchange currency to the main one: a Nairobi shop keeping books in KES and
   * taking dollars at the counter is main KES, exchange USD, rate 130 — "1 USD
   * = 130 KES".
   *
   * Written out live because the direction is the single most reversible thing
   * on this screen, and a rate entered backwards misprices every foreign
   * payment the business ever takes.
   */
  const preview =
    mainCurrency?.length === 3 &&
    exchangeCurrency?.length === 3 &&
    Number.isFinite(exchangeRate) &&
    exchangeRate > 0
      ? `1 ${exchangeCurrency.toUpperCase()} = ${exchangeRate} ${mainCurrency.toUpperCase()}`
      : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-[7px]">
        <Label htmlFor="onboarding-main-currency">Main currency</Label>
        <Input
          autoCapitalize="characters"
          className="h-11 rounded-[10px] bg-card font-mono uppercase"
          id="onboarding-main-currency"
          list="onboarding-currency-options"
          maxLength={3}
          placeholder="KES"
          {...register("mainCurrency")}
          aria-describedby={
            errors.mainCurrency ? "onboarding-main-currency-error" : undefined
          }
          aria-invalid={errors.mainCurrency ? true : undefined}
        />
        <p className="text-[12px] text-muted-3">
          The currency your books are kept in. Every total in TradeOs is this
          one.
        </p>
        {errors.mainCurrency ? (
          <p
            className="text-[13px] text-destructive"
            id="onboarding-main-currency-error"
          >
            {errors.mainCurrency.message}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-[7px]">
        <Label htmlFor="onboarding-exchange-currency">Exchange currency</Label>
        <Input
          autoCapitalize="characters"
          className="h-11 rounded-[10px] bg-card font-mono uppercase"
          id="onboarding-exchange-currency"
          list="onboarding-currency-options"
          maxLength={3}
          placeholder="USD"
          {...register("exchangeCurrency")}
          aria-describedby={
            errors.exchangeCurrency
              ? "onboarding-exchange-currency-error"
              : undefined
          }
          aria-invalid={errors.exchangeCurrency ? true : undefined}
        />
        <p className="text-[12px] text-muted-3">
          The second currency you accept at the counter.
        </p>
        {errors.exchangeCurrency ? (
          <p
            className="text-[13px] text-destructive"
            id="onboarding-exchange-currency-error"
          >
            {errors.exchangeCurrency.message}
          </p>
        ) : null}
      </div>

      <datalist id="onboarding-currency-options">
        {COMMON_CURRENCIES.map((code) => (
          <option key={code} value={code} />
        ))}
      </datalist>

      <div className="flex flex-col gap-[7px]">
        <Label htmlFor="onboarding-exchange-rate">Exchange rate</Label>
        <Input
          className="h-11 rounded-[10px] bg-card font-mono"
          id="onboarding-exchange-rate"
          inputMode="decimal"
          min="0"
          placeholder="130"
          step="any"
          type="number"
          // `valueAsNumber`, so zod sees a number rather than a string it would
          // reject as the wrong type. An empty field becomes NaN, which is why
          // the schema puts a readable message on `z.number()` itself.
          {...register("exchangeRate", { valueAsNumber: true })}
          aria-describedby={
            errors.exchangeRate
              ? "onboarding-exchange-rate-error"
              : "onboarding-exchange-rate-preview"
          }
          aria-invalid={errors.exchangeRate ? true : undefined}
        />
        <p
          className="text-[12px] text-muted-3"
          id="onboarding-exchange-rate-preview"
        >
          {preview ?? "How much of your main currency one unit is worth."}
        </p>
        {errors.exchangeRate ? (
          <p
            className="text-[13px] text-destructive"
            id="onboarding-exchange-rate-error"
          >
            {errors.exchangeRate.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
