/**
 * The IANA timezone list the business-profile form offers, and the check its
 * schema runs.
 *
 * **Why a picker rather than a text field.** The zone chosen here is the one
 * every report, every receipt and every `today`/`week`/`month` aggregation on
 * the platform is measured in (`Backend/src/lib/period.ts`). The backend now
 * validates it as a real zone (Backend commit `5179756`), so a typo comes back
 * as a 422 rather than being stored — but a 422 on a free-text field is still
 * a dead end for someone who does not know the spelling of their own zone, and
 * before that commit the same typo was accepted silently and every
 * period-scoped read for the tenant then worked from a `TZDate` whose
 * `getTime()` is `NaN`. Offering only real zones is what makes the mistake
 * unreachable from this screen in either regime.
 *
 * No React, no hooks: this is called from a zod refinement as well as from the
 * component.
 */

/**
 * Every zone this runtime knows, sorted.
 *
 * `Intl.supportedValuesOf` is ES2022 and present in every browser this app
 * targets, but it is **absent in some runtimes** — older Safari, and a Node
 * built without full ICU, which is what a CI box can be. A crash on a settings
 * page because a list could not be enumerated would be a much worse failure
 * than a shorter list, so an unavailable API degrades to a small set of common
 * zones plus UTC rather than throwing.
 */
const FALLBACK_ZONES = [
  "UTC",
  "Africa/Nairobi",
  "Africa/Mogadishu",
  "Africa/Dar_es_Salaam",
  "Africa/Kampala",
  "Africa/Addis_Ababa",
  "Africa/Lagos",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Kolkata",
  "America/New_York",
  "America/Los_Angeles",
] as const;

const listZones = (): string[] => {
  const supported = (
    Intl as typeof Intl & {
      supportedValuesOf?: (key: string) => string[];
    }
  ).supportedValuesOf;

  if (typeof supported !== "function") return [...FALLBACK_ZONES];

  try {
    const zones = supported("timeZone");
    // A runtime that answers with an empty array is as useless as one that
    // does not implement it at all, and the empty dropdown would be worse
    // because it looks like a loading bug rather than a limitation.
    return zones.length > 0 ? [...zones] : [...FALLBACK_ZONES];
  } catch {
    return [...FALLBACK_ZONES];
  }
};

/**
 * Computed once at module load. The set does not change while a tab is open,
 * and rebuilding ~600 strings on every keystroke of the filter box would be
 * the one avoidable cost on this screen.
 */
export const TIMEZONES: readonly string[] = listZones()
  .slice()
  .sort((a, b) => a.localeCompare(b));

const TIMEZONE_SET = new Set(TIMEZONES);

/**
 * Whether `value` is a zone this runtime can actually resolve.
 *
 * Membership of `TIMEZONES` first, because that is the cheap answer and covers
 * everything the picker can produce. The `Intl` probe behind it exists for the
 * fallback path above: on a runtime with no `supportedValuesOf` the list is
 * fifteen zones long, and rejecting a business's real, resolvable zone because
 * this build could not enumerate it would lock them out of saving their own
 * settings.
 */
export function isSupportedTimezone(value: string): boolean {
  if (TIMEZONE_SET.has(value)) return true;
  if (value.length === 0) return false;

  try {
    // Throws `RangeError` for anything Intl cannot resolve, which is exactly
    // the failure a stored garbage zone produces downstream in `TZDate`.
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * `"Africa/Nairobi"` → `"Africa / Nairobi · GMT+3"`.
 *
 * The offset is what someone actually recognises — most people know they are
 * "GMT+3" and are guessing between two city names — and it is read from `Intl`
 * at render time so it follows daylight saving rather than being frozen into a
 * table that goes wrong twice a year.
 */
export function describeTimezone(zone: string, now: Date = new Date()): string {
  const label = zone.replace(/_/g, " ").replace("/", " / ");
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    }).formatToParts(now);
    const offset = parts.find((part) => part.type === "timeZoneName")?.value;
    return offset ? `${label} · ${offset}` : label;
  } catch {
    return label;
  }
}
