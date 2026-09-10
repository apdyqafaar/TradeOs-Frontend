import { z } from "zod";
import { isSupportedTimezone } from "@/features/organization/lib/timezones";

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
 * `PATCH /organizations/current` — **not** a `.partial()` of the create
 * schema, and deliberately so.
 *
 * The backend's `updateOrganizationSchema`
 * (`Backend/src/validators/organization.validation.ts:20-30`) is a different
 * object: it drops both currency codes and the rate (those move only through
 * `PATCH /organizations/current/currency`) and adds `phone`, `address` and
 * `logoUploadId`. Mirroring it as `createOrganizationSchema.partial()` would
 * accept a payload the API strips to `{}` and then answers 422 on.
 *
 * `phone` and `address` have **min 0** upstream, so `""` is legal and is how a
 * field is cleared. That is why neither carries a `.min(1)` here — adding one
 * would make the form unable to erase a phone number the business no longer
 * uses.
 *
 * `slug`, `ownerId`, `status`, `logo` and every currency key are absent
 * because the API strips them; sending one is not an error, it simply does
 * nothing, and a body of only stripped keys is a 422 through the
 * "at least one field" refinement.
 */
export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(1, "Business name is required").max(120),
  /**
   * Checked against the browser's own IANA database rather than only bounded.
   *
   * The backend now validates this as a real zone (Backend commit `5179756`),
   * so a typo is a 422 instead of a silent write — but the older failure mode
   * is worth remembering when reading this rule: a garbage zone reaches
   * `TZDate`, whose `getTime()` is then `NaN`, and every period-scoped report
   * for the tenant reads empty. The picker only ever offers real zones; this
   * refinement is what catches a value that arrived some other way.
   */
  timezone: z
    .string()
    .trim()
    .min(1, "Timezone is required")
    .max(100, "That timezone name is too long")
    .refine(isSupportedTimezone, "Choose a timezone from the list"),
  /** `""` clears it. Max 40 upstream. */
  phone: z.string().trim().max(40, "Phone number is too long"),
  /** `""` clears it. Max 200 upstream. */
  address: z.string().trim().max(200, "Address is too long"),
  /**
   * The id of an already-uploaded image with `purpose: "logo"`, or `null` to
   * detach the current one.
   *
   * Optional because it is the one field on this form that is only sent when
   * it changed: `publicOrganization` returns the derived `logo` **URL** and
   * never the `logoUploadId` behind it, so an edit form cannot echo back the
   * id it already has. Re-sending the same id for the same organization is
   * idempotent upstream, but there is no id here to re-send.
   *
   * 24-hex because that is what the API's `objectId` rule accepts; anything
   * else is a 422 before any lookup.
   */
  logoUploadId: z
    .string()
    .regex(/^[0-9a-f]{24}$/, "That is not a valid image")
    .nullable()
    .optional(),
});

export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

/**
 * `PATCH /organizations/current/currency`.
 *
 * All three fields together, never a partial. A one-field PATCH is legal
 * upstream and is exactly what breaks the pair: sending `{ mainCurrency:
 * "KES" }` leaves `exchangeCurrency` and `exchangeRate` describing the
 * currency that used to be main, and nothing recalculates. The form submits
 * the whole triple so the three can never disagree.
 *
 * **The refinement is the part the API does not have.** Nothing upstream
 * compares the two codes — verified by running the real validator
 * (`docs/contracts/settings-account.md` §3): `{ mainCurrency: "USD",
 * exchangeCurrency: "USD" }` parses fine. The damage is silent and downstream:
 * `resolveRate` (`Backend/src/services/debt.service.ts:25-38`,
 * `sale.service.ts:57`) tests `currency === config.mainCurrency` **first**, so
 * with both set to USD every amount resolves to rate 1 and the configured
 * `exchangeRate` becomes dead data that no sale, payment or debt will ever
 * apply. The business would see a rate on this screen and none of its money.
 */
export const updateCurrencySchema = z
  .object({
    mainCurrency: currencyCode("Main currency"),
    exchangeCurrency: currencyCode("Exchange currency"),
    /**
     * Must reach the API as a JSON **number**: `exchangeRate: "600"` is a 422
     * (contract §3). `z.number()` here is what keeps a string from an
     * `<input>` reaching the service at all — the form parses before it sends.
     */
    exchangeRate: z
      .number({ error: "Exchange rate is required" })
      .positive("Exchange rate must be greater than zero")
      .finite("Exchange rate must be a number"),
  })
  .refine((data) => data.mainCurrency !== data.exchangeCurrency, {
    path: ["exchangeCurrency"],
    message:
      "Pick a different second currency — with both the same, the rate is never applied",
  });

export type UpdateCurrencyInput = z.infer<typeof updateCurrencySchema>;
