import type { ObjectId } from "@/lib/api/types";

/**
 * The domain shapes the `/organizations` endpoints return.
 *
 * Taken from the `publicOrganization` and `publicCurrency` shapers in
 * `Backend/src/controller/organization.controller.ts`, not from the Mongoose
 * models — no raw document reaches the wire, and the shapers drop
 * `organizationId`, `logoUploadId`, `__v` and `updatedAt` from the
 * organization.
 */

/**
 * `publicOrganization`. Note what is NOT here: **there is no `currency` field
 * on an organization at all.** The backend's Task 26 moved currency onto its
 * own `CurrencyConfig` collection with its own endpoints, so the only way to
 * learn what a business prices in is `GET /organizations/current/currency`.
 * A `currency` on this type would be a field the API never sends.
 */
export interface Organization {
  id: ObjectId;
  name: string;
  /** Derived server-side from `name`; a client never sends or edits it. */
  slug: string;
  /** IANA zone. The backend defaults it to `"UTC"`, never to the browser's. */
  timezone: string;
  phone?: string;
  address?: string;
  /** Public URL derived from `logoUploadId`; absent until a logo is attached. */
  logo?: string;
  status: OrganizationStatus;
  /** ISO 8601 string, not a `Date` — JSON has no date type. */
  createdAt: string;
}

/** `organization.model.ts`: the enum is exactly these two. */
export type OrganizationStatus = "active" | "suspended";

/**
 * `publicCurrency` — `GET /organizations/current/currency`.
 *
 * **Rate direction, from `Backend/src/lib/money.ts`:** `exchangeRate` is
 * *units of MAIN per one unit of EXCHANGE*, so `toMain(amount, rate)`
 * multiplies. A business that keeps books in KES and takes USD at the counter
 * is `mainCurrency: "KES"`, `exchangeCurrency: "USD"`, `exchangeRate: 130`.
 */
export interface CurrencyConfig {
  /** ISO 4217. The currency this business keeps its books in. */
  mainCurrency: string;
  /** ISO 4217. The second currency accepted at the counter. */
  exchangeCurrency: string;
  /** Units of `mainCurrency` per one unit of `exchangeCurrency`. Always > 0. */
  exchangeRate: number;
  updatedAt: string;
}

/**
 * What `POST /organizations` answers with — three objects, not one.
 *
 * The handler mints an Organization, its CurrencyConfig and the caller's owner
 * Member in a single transaction, and returns the first two plus the role that
 * was attached. Typing this as `Organization` alone (as the plan's interface
 * note does) would drop the currency the app needs immediately afterwards and
 * the permissions the shell renders from.
 */
export interface CreateOrganizationResult {
  organization: Organization;
  currency: CurrencyConfig;
  role: { id: ObjectId; name: string; permissions: string[] };
}
