import { z } from "zod";

/**
 * MIRROR OF `Backend/src/validators/organization.validation.ts`.
 *
 * Every bound and every message below is copied from that file so the browser
 * refuses what the API would refuse, with the same words. This schema is not
 * the authority — the API validates again and answers a 422 whose `errors` map
 * `fieldErrorsFor` feeds into `setError`. When the backend validator changes,
 * change this file in the same commit.
 *
 * Deliberately `z.object`, not `z.strictObject`: the backend's schemas here
 * are plain objects, and their comments say so explicitly — Zod's default
 * key-stripping is what stops a client sending `slug`, `ownerId`, `status` or
 * `organizationId`. An unknown key is dropped by the API, not rejected, so
 * mirroring it as strict would reject payloads the API happily accepts.
 */

/**
 * ISO 4217, uppercased before the pattern is checked so `usd` is accepted and
 * stored as `USD`. Rejected rather than defaulted, per the backend's comment:
 * a wrong currency silently reinterprets every amount this business ever
 * records.
 */
const currencyCode = (label: string) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, `${label} must be a 3-letter code such as USD`);

/**
 * `POST /organizations`.
 *
 * All five fields together or nothing: there is no partial create, because the
 * handler writes the Organization, its CurrencyConfig and the owner Member in
 * one transaction (`createOrganizationForUser`). That is why the onboarding
 * wizard collects the currency up front instead of leaving it to Settings.
 */
export const createOrganizationSchema = z.object({
  name: z.string().trim().min(1, "Business name is required").max(120),
  /**
   * The zone the business's day is measured in — its books, not the browser's
   * clock. Bounded at 100 to match the backend; an IANA name is far shorter.
   */
  timezone: z
    .string()
    .trim()
    .min(1, "Timezone is required")
    .max(100, "That timezone name is too long"),
  mainCurrency: currencyCode("Main currency"),
  exchangeCurrency: currencyCode("Exchange currency"),
  /**
   * Units of `mainCurrency` per one unit of `exchangeCurrency`
   * (`Backend/src/lib/money.ts`, `toMain`). No default: an assumed rate
   * misprices every converted amount, and 1 is only correct for a
   * single-currency business.
   *
   * The `error` on `z.number()` itself matters as much as the refinements. An
   * empty `<input type="number">` registered with `valueAsNumber` yields
   * `NaN`, and Zod 4 fails the base type check before `.positive()` ever runs
   * — without this the user reads "expected number, received NaN".
   */
  exchangeRate: z
    .number({ error: "Exchange rate is required" })
    .positive("Exchange rate must be greater than zero")
    .finite("Exchange rate must be a number"),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

/**
 * The backend's `updateOrganizationSchema` and `updateCurrencySchema` are NOT
 * mirrored here. They belong to the Settings screen, which is a later slice,
 * and a mirror nothing imports is a copy that drifts from its original with
 * nothing to notice. When Settings lands, copy them then — and note that the
 * update schema is genuinely different from this one rather than a
 * `.partial()` of it: it drops both currencies and the rate (those move only
 * through `PATCH /organizations/current/currency`) and adds `phone`,
 * `address` and `logoUploadId`.
 */
