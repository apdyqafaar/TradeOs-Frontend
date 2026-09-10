/**
 * The ISO-4217 codes the currency form offers.
 *
 * **Why a curated list and not a text field.** The API shape-checks the code
 * and nothing more — `/^[A-Z]{3}$/`
 * (`Backend/src/validators/organization.validation.ts:34-39`, mirrored in
 * `currency-config.model.ts:15-24`) — so `"ZZZ"`, `"ABC"` and a typo'd `"KSE"`
 * are all stored happily. Every amount this business ever records is then
 * labelled with a currency that does not exist, and `formatMoney` prints the
 * label back verbatim because it deliberately renders the **code**, never a
 * symbol.
 *
 * **Why this list is not "the currency".** Nothing here is a default: the form
 * has no preselected code, the create flow rejects rather than defaults
 * (backend's own comment), and `useOrganization` falls back to `""` rather
 * than to a plausible code. This is a menu, not an assumption.
 *
 * The list leans East African because that is the market, then covers the
 * currencies a shop there is realistically also handed. It is not exhaustive
 * and does not need to be — `ensureCurrencyOption` keeps whatever the business
 * already has selectable even when it is not listed, so a code set through the
 * API or through an older build can never be silently dropped by opening this
 * screen.
 */

export interface CurrencyOption {
  /** ISO 4217, uppercase. This is what goes on the wire and onto receipts. */
  code: string;
  /** For the dropdown only. Never rendered next to an amount. */
  name: string;
}

export const CURRENCIES: readonly CurrencyOption[] = [
  { code: "KES", name: "Kenyan shilling" },
  { code: "SOS", name: "Somali shilling" },
  { code: "TZS", name: "Tanzanian shilling" },
  { code: "UGX", name: "Ugandan shilling" },
  { code: "ETB", name: "Ethiopian birr" },
  { code: "DJF", name: "Djiboutian franc" },
  { code: "RWF", name: "Rwandan franc" },
  { code: "BIF", name: "Burundian franc" },
  { code: "SSP", name: "South Sudanese pound" },
  { code: "SDG", name: "Sudanese pound" },
  { code: "USD", name: "US dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "Pound sterling" },
  { code: "AED", name: "UAE dirham" },
  { code: "SAR", name: "Saudi riyal" },
  { code: "QAR", name: "Qatari riyal" },
  { code: "TRY", name: "Turkish lira" },
  { code: "CNY", name: "Chinese yuan" },
  { code: "INR", name: "Indian rupee" },
  { code: "ZAR", name: "South African rand" },
  { code: "NGN", name: "Nigerian naira" },
  { code: "EGP", name: "Egyptian pound" },
  { code: "GHS", name: "Ghanaian cedi" },
  { code: "CAD", name: "Canadian dollar" },
  { code: "AUD", name: "Australian dollar" },
  { code: "CHF", name: "Swiss franc" },
  { code: "JPY", name: "Japanese yen" },
] as const;

/**
 * The catalog, plus `code` if the business is already using something the
 * catalog does not list.
 *
 * Without this, opening the currency tab on a business set to a code outside
 * the list would show an empty `<select>`, and saving the form — which submits
 * all three fields together, by design — would overwrite a working
 * configuration with whatever happened to be first. An unknown code is
 * labelled as such rather than invented a name for.
 */
export function ensureCurrencyOption(
  code: string,
  catalog: readonly CurrencyOption[] = CURRENCIES,
): readonly CurrencyOption[] {
  const normalized = code.trim().toUpperCase();
  if (normalized === "") return catalog;
  if (catalog.some((option) => option.code === normalized)) return catalog;

  return [{ code: normalized, name: "Currently in use" }, ...catalog];
}
