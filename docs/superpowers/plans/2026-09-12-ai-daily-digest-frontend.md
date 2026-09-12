# AI Daily Digest — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An **Insights** page that shows the latest AI digest as three cards with its history and a "Generate now" button, an "AI insights" settings form, and an Overview strip — all reading the backend's `/digests` API and the `digest` dashboard section.

**Architecture:** One new feature slice `features/insights/` in the repo's `page → components → hooks → services → lib/api/client` layering, plus three small additions to existing slices: `features/organization` (the `ai` settings), `features/settings` (the form), `features/dashboard` (the Overview strip). Model-written text is rendered as text nodes only; every number shown comes from the digest's stored `pack`, formatted with the business currency and timezone.

**Tech Stack:** Next.js 16 App Router · React 19 + React Compiler (no manual memo) · TanStack Query v5 · axios (`lib/api/client`) · zod v4 · Tailwind v4 · shadcn base-nova on `@base-ui/react` (`render`, never `asChild`) · vitest + happy-dom.

**Spec:** `../Backend/docs/superpowers/specs/2026-09-12-ai-daily-digest-design.md` (§8 API, §11 frontend). The backend plan (`../Backend/docs/superpowers/plans/2026-09-12-ai-daily-digest-backend.md`) fixes the wire shapes quoted below; the two plans can run in parallel because every frontend test mocks at the axios adapter.

## Global Constraints

- Layering: pages are Server Components that open with `const { permitted } = await requirePageAccess(); if (!permitted) return <ForbiddenScreen />;` — `require-page-access.test.ts` walks `app/(app)/**/page.tsx` and fails any page that does not.
- **`docs/API-ROUTES.md` first**: a service function may only call a path listed there. Add the rows before writing the service.
- `useQuery`/`useMutation` only in `hooks/`; keys from `createQueryKeys(scope)`; never hand-write a key array; invalidate through the key object.
- Money through `formatMoney(amount, currencyCode)`; dates through `lib/format/date.ts` with the **business** timezone from `useOrganization()`.
- Links that look like buttons use `<ButtonLink>` (`components/shared/button-link.tsx`); `button-as-link.test.ts` fails any `<Button render={<Link/>}>`.
- Six list states: loading skeleton · empty · filtered-empty (n/a here) · error with request id (`<ErrorCard>`) · 403 · domain codes (`AI_NOT_CONFIGURED`, `AI_DISABLED_FOR_ORGANIZATION`, 429) shown where the action was taken.
- **Model text is data.** Render `sections.*` strings as text nodes; never `dangerouslySetInnerHTML`, never as markdown.
- Gate: `bunx tsc --noEmit`, `bunx biome check .`, `bunx vitest run` all clean before "done". Commit per task.

## Execution waves

| Wave | Tasks | Why |
|---|---|---|
| 0 | **F1** | Routes, nav, API rows, types, keys, services, hooks — everything the three screens import. Lands first, alone. |
| 1 (parallel) | **F2**, **F3**, **F4** | Disjoint files; all depend only on F1. |

## Wire shapes (from the backend plan; do not re-derive)

```ts
// GET /digests/latest, GET /digests/:id  → Digest (with pack)
// GET /digests?page&limit               → { data: DigestSummary[], meta: PageMeta }   (no pack)
// POST /digests/run                     → 202 { localDate: "YYYY-MM-DD" }
//   503 AI_NOT_CONFIGURED · 409 AI_DISABLED_FOR_ORGANIZATION · 429 (Retry-After) · 403
// PATCH /organizations/current/ai       → Organization (with ai)
// GET /dashboard → sections.digest: { id, localDate, status, headline: string|null } | null   (needs reports:view)
```

## File structure

```
docs/API-ROUTES.md                                  (modify) 5 rows
config/routes.ts                                    (modify) ROUTES.insights, ROUTES.insight, nav item, ROUTE_PERMISSIONS
features/insights/types.ts                          (create)
features/insights/keys.ts                           (create)
features/insights/services/digest.service.ts        (create) + .test.ts
features/insights/hooks/use-digests.ts              (create)
features/organization/types.ts                      (modify) Organization.ai, AiSettings, AI_LANGUAGES
features/organization/schemas/organization.schema.ts (modify) updateAiSettingsSchema
features/organization/services/organization.service.ts (modify) updateAiSettings
features/organization/hooks/use-organization-mutations.ts (modify) useUpdateAiSettings

features/settings/components/ai-form.tsx            (create, F2) + .test.tsx
features/settings/components/settings-page.tsx      (modify, F2) third tab

app/(app)/insights/page.tsx                         (create, F3)
app/(app)/insights/[id]/page.tsx                    (create, F3)
features/insights/components/insights-screen.tsx    (create, F3)
features/insights/components/digest-view.tsx        (create, F3) + .test.tsx
features/insights/components/digest-history.tsx     (create, F3)
features/insights/components/run-digest-button.tsx  (create, F3) + .test.tsx
features/insights/components/numbers-behind.tsx     (create, F3)
features/insights/components/digest-detail.tsx      (create, F3)

features/dashboard/types.ts                         (modify, F4) DashboardDigestSection
features/dashboard/components/insights-section.tsx  (create, F4)
features/dashboard/components/overview.tsx          (modify, F4) render it
features/dashboard/components/section-links.test.tsx (modify, F4) one case
```

---

### Task F1: Foundation — routes, API rows, types, keys, services, hooks

**Files:**
- Modify: `docs/API-ROUTES.md`, `config/routes.ts`
- Create: `features/insights/types.ts`, `features/insights/keys.ts`, `features/insights/services/digest.service.ts`, `features/insights/services/digest.service.test.ts`, `features/insights/hooks/use-digests.ts`
- Modify: `features/organization/types.ts`, `features/organization/schemas/organization.schema.ts`, `features/organization/services/organization.service.ts`, `features/organization/hooks/use-organization-mutations.ts`

**Interfaces:**
- Produces `ROUTES.insights`, `ROUTES.insight(id)`; types `Digest`, `DigestSummary`, `DigestStatus`, `DigestSections`, `DayPack`, `AiSettings`, `AiLanguage`, `AI_LANGUAGES`; `digestKeys`; services `getLatestDigest()`, `getDigest(id)`, `listDigests({page,limit})`, `runDigest()`, `updateAiSettings(input)`; hooks `useLatestDigest()`, `useDigest(id)`, `useDigests(page, limit)`, `useRunDigest()`, `useUpdateAiSettings()`; `Organization.ai`.

- [ ] **Step 1: API rows** — in `docs/API-ROUTES.md`, next to the organizations rows and in a new "Digests" group:

```
| PATCH | `/organizations/current/ai` | organization:update |
| GET | `/digests` | reports:view |
| GET | `/digests/latest` | reports:view |
| GET | `/digests/:id` | reports:view |
| POST | `/digests/run` | organization:update |
```

- [ ] **Step 2: Routes and nav** — `config/routes.ts`: in `ROUTES` after `reportsStaff`:

```ts
  insights: "/insights",
  /** One digest. Inherits `/insights`'s `reports:view` by longest-prefix match. */
  insight: (id: string) => `/insights/${id}`,
```

Import `Sparkles` from `lucide-react` and add to the **Main** group directly after the Reports item:

```ts
      {
        label: "Insights",
        href: ROUTES.insights,
        icon: Sparkles,
        permission: PERMISSIONS.REPORTS_VIEW,
      },
```

In `ROUTE_PERMISSIONS` next to `[ROUTES.reports]`: `[ROUTES.insights]: PERMISSIONS.REPORTS_VIEW,`.

- [ ] **Step 3: Organization types, schema, service, hook**

`features/organization/types.ts` — add:

```ts
export const AI_LANGUAGES = ["en", "so", "sw", "am"] as const;
export type AiLanguage = (typeof AI_LANGUAGES)[number];
export const AI_LANGUAGE_LABELS: Record<AiLanguage, string> = {
  en: "English",
  so: "Somali",
  sw: "Swahili",
  am: "Amharic",
};

/** Mirrors `Organization.ai` on the API (Backend spec §4.1). */
export interface AiSettings {
  enabled: boolean;
  language: AiLanguage;
  /** 0–23, in the business timezone. */
  hourLocal: number;
}
```

and inside `interface Organization` after `status`: `ai: AiSettings;`.

`features/organization/schemas/organization.schema.ts` — add:

```ts
import { AI_LANGUAGES } from "@/features/organization/types";

export const updateAiSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    language: z.enum(AI_LANGUAGES).optional(),
    hourLocal: z.number().int().min(0).max(23).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: "Change at least one setting" });

export type UpdateAiSettingsInput = z.infer<typeof updateAiSettingsSchema>;
```

`features/organization/services/organization.service.ts` — add:

```ts
export const updateAiSettings = (input: UpdateAiSettingsInput): Promise<Organization> =>
  apiPatch<Organization>("/organizations/current/ai", input);
```

`features/organization/hooks/use-organization-mutations.ts` — add, following `useUpdateCurrencyConfig` exactly:

```ts
export function useUpdateAiSettings(): UseMutationResult<Organization, ApiError, UpdateAiSettingsInput> {
  const queryClient = useQueryClient();
  return useMutation<Organization, ApiError, UpdateAiSettingsInput>({
    mutationFn: updateAiSettings,
    onSuccess: () => {
      // The profile query holds `ai`; invalidating the scope reaches it whatever its exact key.
      void queryClient.invalidateQueries({ queryKey: organizationKeys.all });
    },
  });
}
```

- [ ] **Step 4: Insights types**

`features/insights/types.ts`:

```ts
import type { AiLanguage } from "@/features/organization/types";

export type DigestStatus = "complete" | "partial" | "failed";
export type SectionKey = "revenue" | "debtsStock" | "recommendations";

export interface RevenueSection {
  headline: string;
  points: string[];
  comparison: { vsLastWeek: string; monthToDate: string };
  anomalies: string[];
}
export interface DebtsStockSection {
  headline: string;
  debts: string[];
  stock: string[];
}
export interface RecommendationAction {
  priority: "high" | "medium" | "low";
  kind: "chase" | "restock" | "review" | "promote" | "other";
  text: string;
}
export interface RecommendationsSection {
  actions: RecommendationAction[];
  warnings: string[];
}
export interface DigestSections {
  revenue: RevenueSection | null;
  debtsStock: DebtsStockSection | null;
  recommendations: RecommendationsSection | null;
}

/** The numbers the agents were given — transcribed from the backend's `DayPack`. */
export interface DayPack {
  organization: { name: string; currency: string; timezone: string; localDate: string; weekday: string };
  revenue: {
    today: { revenue: number; grossProfit: number; count: number; cash: number; credit: number; discounts: number; voids: { count: number; amount: number } };
    sameWeekdayLastWeek: { revenue: number; count: number };
    trailing7DayAvg: { revenue: number; count: number };
    monthToDate: { revenue: number; count: number };
    previousMonthSameSpan: { revenue: number; count: number };
    topProducts: { name: string; quantity: number; revenue: number }[];
    bySeller: { name: string; revenue: number; count: number; voids: number }[];
    hourly: { hour: number; revenue: number }[];
  };
  debts: {
    outstanding: number; overdueAmount: number; overdueCount: number;
    newCreditToday: { amount: number; count: number };
    paymentsToday: { amount: number; count: number };
    fellOverdueToday: { customer: string; remaining: number; daysOverdue: number }[];
    topOverdue: { customer: string; remaining: number; daysOverdue: number }[];
    creditShareToday: number; creditShare30Day: number;
  };
  stock: {
    soldOutToday: { name: string; soldOutAtHour: number | null }[];
    low: { name: string; quantity: number; threshold: number | null }[];
    velocity: { name: string; perDay: number; quantity: number; daysLeft: number }[];
    restockedToday: { name: string; quantity: number }[];
  };
}

/** `GET /digests` rows — everything but the pack. */
export interface DigestSummary {
  id: string;
  localDate: string;
  timezone: string;
  language: AiLanguage;
  model: string;
  trigger: "cron" | "manual";
  requestedBy?: string;
  status: DigestStatus;
  sections: DigestSections;
  errors: { section: SectionKey; message: string }[];
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
  generatedAt: string;
  createdAt: string;
}

export interface Digest extends DigestSummary {
  pack: DayPack;
}

export interface RunDigestResult {
  localDate: string;
}
```

- [ ] **Step 5: Keys, service, service test, hooks**

`features/insights/keys.ts`:

```ts
import { createQueryKeys } from "@/lib/query/keys";

const base = createQueryKeys("digests");

export const digestKeys = {
  ...base,
  /** The one the Insights page and the Overview strip both watch. */
  latest: () => ["digests", "latest"] as const,
};
```

`features/insights/services/digest.service.ts`:

```ts
import type { Digest, DigestSummary, RunDigestResult } from "@/features/insights/types";
import { apiGet, apiGetList, apiPost } from "@/lib/api/client";

const BASE = "/digests";

export const getLatestDigest = (): Promise<Digest> => apiGet<Digest>(`${BASE}/latest`);
export const getDigest = (id: string): Promise<Digest> => apiGet<Digest>(`${BASE}/${id}`);
export const listDigests = (params: { page: number; limit: number }) =>
  apiGetList<DigestSummary>(BASE, params);
/** 202 — the digest arrives later; callers poll `getLatestDigest`. */
export const runDigest = (): Promise<RunDigestResult> => apiPost<RunDigestResult>(`${BASE}/run`, {});
```

Match `apiGetList`'s real signature in `lib/api/client.ts:346` (params argument name and return type `{ data, meta }`).

`features/insights/services/digest.service.test.ts` — copy the `replyWith` adapter harness from `features/reports/services/report.service.test.ts` verbatim, then:

```ts
describe("digest.service", () => {
  it("runDigest posts an empty body to /digests/run and unwraps the 202 envelope", async () => {
    let seen: InternalAxiosRequestConfig | undefined;
    api.defaults.adapter = async (config) => {
      seen = config;
      return replyWith({ status: 202, data: { success: true, message: "Digest requested", data: { localDate: "2026-09-12" } } })(config);
    };
    const result = await runDigest();
    expect(seen?.url).toBe("/digests/run");
    expect(seen?.method).toBe("post");
    expect(result).toEqual({ localDate: "2026-09-12" });
  });

  it("a 429 becomes an ApiError with status 429, not a raw AxiosError", async () => {
    api.defaults.adapter = replyWith({
      status: 429,
      headers: { "retry-after": "3600", "x-request-id": "req-1" },
      data: { success: false, message: "Too many attempts", code: "TOO_MANY_REQUESTS" },
    });
    await expect(runDigest()).rejects.toSatisfy((e: unknown) => isApiError(e) && e.status === 429 && e.requestId === "req-1");
  });

  it("latest and one-by-id hit their exact paths", async () => {
    const urls: string[] = [];
    api.defaults.adapter = async (config) => {
      urls.push(config.url ?? "");
      return replyWith({ status: 200, data: { success: true, message: "", data: { id: "d1" } } })(config);
    };
    await getLatestDigest();
    await getDigest("d1");
    expect(urls).toEqual(["/digests/latest", "/digests/d1"]);
  });
});
```

`features/insights/hooks/use-digests.ts`:

```ts
"use client";

import { type UseMutationResult, type UseQueryResult, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { digestKeys } from "@/features/insights/keys";
import { getDigest, getLatestDigest, listDigests, runDigest } from "@/features/insights/services/digest.service";
import type { Digest, DigestSummary, RunDigestResult } from "@/features/insights/types";
import type { ApiError } from "@/lib/api/errors";
import type { PageMeta } from "@/lib/api/types";

/**
 * `retry: false` on a 404: "no digest yet" is an answer, and the query
 * client's default would already not retry a 4xx — spelled out so the
 * empty state is understood as deliberate.
 */
export function useLatestDigest(options: { pollMs?: number } = {}): UseQueryResult<Digest, ApiError> {
  return useQuery<Digest, ApiError>({
    queryKey: digestKeys.latest(),
    queryFn: getLatestDigest,
    refetchInterval: options.pollMs ?? false,
    retry: false,
  });
}

export function useDigest(id: string): UseQueryResult<Digest, ApiError> {
  return useQuery<Digest, ApiError>({ queryKey: digestKeys.detail(id), queryFn: () => getDigest(id) });
}

export function useDigests(page: number, limit: number): UseQueryResult<{ data: DigestSummary[]; meta: PageMeta }, ApiError> {
  return useQuery({ queryKey: digestKeys.list({ page, limit }), queryFn: () => listDigests({ page, limit }) });
}

export function useRunDigest(): UseMutationResult<RunDigestResult, ApiError, void> {
  const queryClient = useQueryClient();
  return useMutation<RunDigestResult, ApiError, void>({
    mutationFn: () => runDigest(),
    onSuccess: () => {
      // Nothing to write into the cache yet — the digest lands a minute later.
      // Invalidate so the next poll fetches rather than serving the stale 404.
      void queryClient.invalidateQueries({ queryKey: digestKeys.all });
    },
  });
}
```

- [ ] **Step 6: Gate and commit**

```bash
bunx tsc --noEmit && bunx biome check . && bunx vitest run features/insights features/organization config
git add docs/API-ROUTES.md config/routes.ts features/insights features/organization
git commit -m "feat(insights): routes, types, keys, services and hooks for the AI digest"
```

---

### Task F2: Settings → "AI insights" form

**Files:**
- Create: `features/settings/components/ai-form.tsx`, `features/settings/components/ai-form.test.tsx`
- Modify: `features/settings/components/settings-page.tsx`

**Interfaces:** consumes `useOrganizationProfile()` (existing; returns the `Organization` with `ai`), `useUpdateAiSettings()`, `AI_LANGUAGES`, `AI_LANGUAGE_LABELS`, `updateAiSettingsSchema`, and the primitives in `form-primitives.tsx` (`SettingsPanel`, `Field`, `CONTROL`, `SELECT_CONTROL`, `InfoNote`, `SuccessNote`, `AlertNote`, `ChevronGlyph`).

- [ ] **Step 1: Write the failing test**

`features/settings/components/ai-form.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AiForm } from "./ai-form";

const mutate = vi.fn();
vi.mock("@/features/organization/hooks/use-organization-profile", () => ({
  useOrganizationProfile: () => ({
    isLoading: false,
    data: { id: "o1", name: "Shop", timezone: "Africa/Addis_Ababa", ai: { enabled: false, language: "en", hourLocal: 21 } },
  }),
}));
vi.mock("@/features/organization/hooks/use-organization-mutations", () => ({
  useUpdateAiSettings: () => ({ mutate, isPending: false, isSuccess: false, error: null }),
}));

describe("AiForm", () => {
  it("shows the current settings and the business timezone next to the hour", () => {
    render(<AiForm />);
    expect(screen.getByRole("checkbox", { name: /daily digest/i })).not.toBeChecked();
    expect(screen.getByRole("combobox", { name: /language/i })).toHaveValue("en");
    expect(screen.getByRole("combobox", { name: /closing hour/i })).toHaveValue("21");
    expect(screen.getByText(/Africa\/Addis_Ababa/)).toBeInTheDocument();
  });

  it("submits only what changed", async () => {
    render(<AiForm />);
    await userEvent.click(screen.getByRole("checkbox", { name: /daily digest/i }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /language/i }), "so");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(mutate).toHaveBeenCalledWith({ enabled: true, language: "so" }, expect.anything());
  });

  it("refuses to submit with nothing changed", async () => {
    render(<AiForm />);
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText(/change at least one/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `bunx vitest run features/settings/components/ai-form.test.tsx` → module not found.

- [ ] **Step 3: The form**

`features/settings/components/ai-form.tsx`:

```tsx
"use client";

import { useId, useState } from "react";
import { ErrorCard } from "@/components/shared/error-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useUpdateAiSettings } from "@/features/organization/hooks/use-organization-mutations";
import { useOrganizationProfile } from "@/features/organization/hooks/use-organization-profile";
import { updateAiSettingsSchema, type UpdateAiSettingsInput } from "@/features/organization/schemas/organization.schema";
import { AI_LANGUAGE_LABELS, AI_LANGUAGES, type AiLanguage } from "@/features/organization/types";
import { fieldErrorsFor } from "@/lib/api/errors";
import { AlertNote, CONTROL, Field, InfoNote, SELECT_CONTROL, SettingsPanel, SuccessNote } from "./form-primitives";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const two = (n: number) => String(n).padStart(2, "0");

/**
 * The AI insights settings (Backend spec §4.1, §11).
 *
 * Sends only the fields that differ from what the server holds: the endpoint
 * is a partial PATCH, and posting an unchanged `language` alongside a changed
 * `enabled` would be harmless but would make "what did I change?" unanswerable
 * in the log line the backend writes.
 */
export function AiForm() {
  const profile = useOrganizationProfile();
  const update = useUpdateAiSettings();
  const ids = { enabled: useId(), language: useId(), hour: useId() };
  const [draft, setDraft] = useState<UpdateAiSettingsInput>({});
  const [issue, setIssue] = useState<string | null>(null);

  if (profile.isLoading || !profile.data) return <Skeleton className="h-[280px] rounded-[10px]" />;
  const current = profile.data.ai;
  const value = { ...current, ...draft };

  const set = <K extends keyof UpdateAiSettingsInput>(key: K, next: UpdateAiSettingsInput[K]) =>
    setDraft((d) => (next === current[key] ? omit(d, key) : { ...d, [key]: next }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = updateAiSettingsSchema.safeParse(draft);
    if (!parsed.success) {
      setIssue(parsed.error.issues[0]?.message ?? "Change at least one setting");
      return;
    }
    setIssue(null);
    update.mutate(parsed.data, { onSuccess: () => setDraft({}) });
  };

  const serverErrors = update.error ? fieldErrorsFor(update.error) : {};

  return (
    <SettingsPanel
      title="AI insights"
      description="Every evening, three analysts read the day's figures and write you a short digest: revenue, debts and stock, and what to do tomorrow."
    >
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <Field id={ids.enabled} label="Daily digest">
          <label className="flex items-center gap-3 text-[13px] text-foreground">
            <input
              id={ids.enabled}
              type="checkbox"
              checked={value.enabled}
              onChange={(e) => set("enabled", e.target.checked)}
              className="size-4 accent-primary"
            />
            Generate a digest every evening
          </label>
        </Field>

        <Field id={ids.language} label="Language" error={serverErrors.language}>
          <select id={ids.language} className={SELECT_CONTROL} value={value.language} onChange={(e) => set("language", e.target.value as AiLanguage)}>
            {AI_LANGUAGES.map((code) => (
              <option key={code} value={code}>{AI_LANGUAGE_LABELS[code]}</option>
            ))}
          </select>
        </Field>

        <Field id={ids.hour} label="Closing hour" hint={`In your business timezone, ${profile.data.timezone}.`} error={serverErrors.hourLocal}>
          <select id={ids.hour} className={SELECT_CONTROL} value={String(value.hourLocal)} onChange={(e) => set("hourLocal", Number(e.target.value))}>
            {HOURS.map((h) => (
              <option key={h} value={String(h)}>{two(h)}:00</option>
            ))}
          </select>
        </Field>

        <InfoNote>The digest lands under Insights about a minute after the closing hour. It uses only your own sales, debts and stock, and never sends customer phone numbers to the model.</InfoNote>

        {issue ? <AlertNote>{issue}</AlertNote> : null}
        {update.error && !Object.keys(serverErrors).length ? <ErrorCard error={update.error} /> : null}
        {update.isSuccess && !Object.keys(draft).length ? <SuccessNote>Saved.</SuccessNote> : null}

        <div className="flex justify-end">
          <Button type="submit" disabled={update.isPending}>{update.isPending ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </SettingsPanel>
  );
}

const omit = <T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> => {
  const { [key]: _dropped, ...rest } = obj;
  return rest;
};
```

Adjust the `Field`/`SettingsPanel` prop names to what `form-primitives.tsx` actually exports (`label`, `hint`, `error`, `title`, `description` are the expected ones — read the file; `CONTROL` is unused here if `SELECT_CONTROL` covers the selects, so drop it if biome flags it).

- [ ] **Step 4: The third tab** — in `settings-page.tsx`, widen the tab type to `"business" | "currency" | "ai"`, add a tab control labelled **AI insights** beside the existing two (same markup as the others), and change the render line to:

```tsx
{tab === "business" ? <BusinessForm /> : tab === "currency" ? <CurrencyForm /> : <AiForm />}
```

- [ ] **Step 5: Run, gate, commit**

```bash
bunx vitest run features/settings && bunx tsc --noEmit && bunx biome check .
git add features/settings
git commit -m "feat(settings): AI insights — enable, language and closing hour"
```

---

### Task F3: The Insights pages

**Files:**
- Create: `app/(app)/insights/page.tsx`, `app/(app)/insights/[id]/page.tsx`
- Create: `features/insights/components/insights-screen.tsx`, `digest-view.tsx`, `digest-view.test.tsx`, `digest-history.tsx`, `run-digest-button.tsx`, `run-digest-button.test.tsx`, `numbers-behind.tsx`, `digest-detail.tsx`

**Interfaces:** consumes F1's hooks and types, `useOrganization()` (`timezone`, `currency`), `useCan(PERMISSIONS.ORGANIZATION_UPDATE)`, `formatMoney`, `formatDate`, `ErrorCard`, `EmptyState`, `Skeleton`, `ButtonLink`, `DataTable` (for history, optional — a plain list is fine).

- [ ] **Step 1: Pages**

`app/(app)/insights/page.tsx`:

```tsx
import type { Metadata } from "next";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { InsightsScreen } from "@/features/insights/components/insights-screen";
import { requirePageAccess } from "@/lib/auth/require-page-access";

export const metadata: Metadata = { title: "Insights" };

export default async function InsightsPage() {
  const { permitted } = await requirePageAccess();
  if (!permitted) return <ForbiddenScreen />;
  return <InsightsScreen />;
}
```

`app/(app)/insights/[id]/page.tsx`:

```tsx
import type { Metadata } from "next";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { DigestDetail } from "@/features/insights/components/digest-detail";
import { requirePageAccess } from "@/lib/auth/require-page-access";

export const metadata: Metadata = { title: "Digest" };

// `params` is a Promise in Next 16.
export default async function DigestPage({ params }: { params: Promise<{ id: string }> }) {
  const { permitted } = await requirePageAccess();
  if (!permitted) return <ForbiddenScreen />;
  const { id } = await params;
  return <DigestDetail id={id} />;
}
```

- [ ] **Step 2: Write the failing view test**

`features/insights/components/digest-view.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Digest } from "@/features/insights/types";
import { DigestView } from "./digest-view";

const digest = (overrides: Partial<Digest> = {}): Digest => ({
  id: "d1", localDate: "2026-09-12", timezone: "Africa/Addis_Ababa", language: "en", model: "m", trigger: "cron",
  status: "complete",
  sections: {
    revenue: { headline: "A steady Saturday", points: ["Cooking oil led"], comparison: { vsLastWeek: "down 18%", monthToDate: "6% ahead" }, anomalies: ["One void of ETB 4,000"] },
    debtsStock: { headline: "Credit crept up", debts: ["Juma Kiosk fell overdue"], stock: ["Bar soap sold out at 14:00"] },
    recommendations: { actions: [{ priority: "high", kind: "chase", text: "Call Hodan Traders" }], warnings: ["Batteries run out in 3 days"] },
  },
  errors: [], usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, generatedAt: "2026-09-12T18:06:00.000Z", createdAt: "2026-09-12T18:06:00.000Z",
  pack: { organization: { name: "S", currency: "ETB", timezone: "Africa/Addis_Ababa", localDate: "2026-09-12", weekday: "Saturday" } } as Digest["pack"],
  ...overrides,
});

describe("DigestView", () => {
  it("renders the three cards from the sections", () => {
    render(<DigestView digest={digest()} currency="ETB" timezone="Africa/Addis_Ababa" />);
    expect(screen.getByText("A steady Saturday")).toBeInTheDocument();
    expect(screen.getByText("Juma Kiosk fell overdue")).toBeInTheDocument();
    expect(screen.getByText("Call Hodan Traders")).toBeInTheDocument();
  });

  it("a partial digest shows the sections it has and names the one it lacks", () => {
    render(
      <DigestView
        digest={digest({ status: "partial", sections: { ...digest().sections, debtsStock: null }, errors: [{ section: "debtsStock", message: "x" }] })}
        currency="ETB" timezone="Africa/Addis_Ababa"
      />,
    );
    expect(screen.getByText("A steady Saturday")).toBeInTheDocument();
    expect(screen.getByText(/debts and stock could not be written/i)).toBeInTheDocument();
  });

  it("model text is rendered as text, never as markup", () => {
    render(
      <DigestView
        digest={digest({ sections: { ...digest().sections, revenue: { ...digest().sections.revenue!, headline: "<img src=x onerror=alert(1)>" } } })}
        currency="ETB" timezone="Africa/Addis_Ababa"
      />,
    );
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});
```

- [ ] **Step 3: Components**

`features/insights/components/digest-view.tsx`:

```tsx
import { AlertTriangle } from "lucide-react";
import type { Digest, RecommendationAction } from "@/features/insights/types";
import { formatDate } from "@/lib/format/date";
import { cn } from "cn";

const PRIORITY: Record<RecommendationAction["priority"], string> = {
  high: "bg-destructive-soft text-destructive-strong",
  medium: "bg-warning-soft text-warning-strong",
  low: "bg-muted text-muted-foreground",
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-[12px] border border-border bg-card p-5">
      <h2 className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Missing({ what }: { what: string }) {
  return (
    <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
      <AlertTriangle className="size-4 text-warning-strong" aria-hidden="true" />
      The {what} section could not be written last night. The numbers below are still real.
    </p>
  );
}

const Lines = ({ items }: { items: string[] }) => (
  <ul className="flex flex-col gap-1.5 text-[13px] text-foreground">
    {items.map((line) => (
      // Model text is a text node. Never markup.
      <li key={line} className="leading-relaxed">{line}</li>
    ))}
  </ul>
);

export function DigestView({ digest, currency, timezone }: { digest: Digest; currency: string; timezone: string }) {
  const { revenue, debtsStock, recommendations } = digest.sections;
  void currency;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        {formatDate(digest.generatedAt, timezone)} · {digest.status === "complete" ? "complete" : digest.status}
      </p>

      <Card title="Revenue">
        {revenue ? (
          <>
            <p className="font-serif text-xl text-foreground leading-tight">{revenue.headline}</p>
            <Lines items={revenue.points} />
            <p className="text-[13px] text-muted-foreground">{revenue.comparison.vsLastWeek} · {revenue.comparison.monthToDate}</p>
            {revenue.anomalies.length ? <Lines items={revenue.anomalies} /> : null}
          </>
        ) : <Missing what="revenue" />}
      </Card>

      <Card title="Debts & stock">
        {debtsStock ? (
          <>
            <p className="font-serif text-xl text-foreground leading-tight">{debtsStock.headline}</p>
            <Lines items={debtsStock.debts} />
            <Lines items={debtsStock.stock} />
          </>
        ) : <Missing what="debts and stock" />}
      </Card>

      <Card title="What to do tomorrow">
        {recommendations ? (
          <>
            <ol className="flex flex-col gap-2">
              {recommendations.actions.map((action) => (
                <li key={action.text} className="flex items-start gap-2 text-[13px] text-foreground">
                  <span className={cn("inline-flex h-[20px] flex-none items-center rounded-lg px-2 font-mono text-[10px] uppercase", PRIORITY[action.priority])}>{action.kind}</span>
                  <span className="leading-relaxed">{action.text}</span>
                </li>
              ))}
            </ol>
            {recommendations.warnings.length ? <Lines items={recommendations.warnings} /> : null}
          </>
        ) : <Missing what="recommendations" />}
      </Card>
    </div>
  );
}
```

`features/insights/components/run-digest-button.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useLatestDigest, useRunDigest } from "@/features/insights/hooks/use-digests";
import { API_ERROR_CODE } from "@/lib/api/errors";

const POLL_MS = 5_000;
const GIVE_UP_MS = 120_000;

/**
 * Posts `/digests/run`, then polls `latest` every 5s for up to two minutes
 * (Backend spec §11). The three-a-day limit is the server's; a 429 is shown
 * where the click happened, not swallowed.
 */
export function RunDigestButton({ sinceLocalDate }: { sinceLocalDate: string | null }) {
  const run = useRunDigest();
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const latest = useLatestDigest({ pollMs: waitingFor ? POLL_MS : undefined });

  useEffect(() => {
    if (!waitingFor) return;
    if (latest.data && latest.data.localDate === waitingFor && latest.data.generatedAt > new Date(startedAt).toISOString()) setWaitingFor(null);
    else if (Date.now() - startedAt > GIVE_UP_MS) setWaitingFor(null);
  }, [waitingFor, latest.data, startedAt]);

  const message = run.error
    ? run.error.status === 429
      ? "You've used today's three manual runs. The evening digest still arrives on schedule."
      : run.error.code === API_ERROR_CODE.AI_DISABLED_FOR_ORGANIZATION
        ? "Turn on the daily digest in Settings → AI insights first."
        : run.error.code === API_ERROR_CODE.AI_NOT_CONFIGURED
          ? "AI insights are not set up on this server yet."
          : run.error.message
    : waitingFor
      ? "Generating… this takes about a minute."
      : null;

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        type="button"
        disabled={run.isPending || Boolean(waitingFor)}
        onClick={() =>
          run.mutate(undefined, {
            onSuccess: ({ localDate }) => {
              setStartedAt(Date.now());
              setWaitingFor(localDate);
            },
          })
        }
      >
        {waitingFor ? "Generating…" : sinceLocalDate ? "Generate again" : "Generate now"}
      </Button>
      {message ? <p className="text-xs text-muted-foreground" role="status">{message}</p> : null}
    </div>
  );
}
```

Add `AI_NOT_CONFIGURED: "AI_NOT_CONFIGURED"` and `AI_DISABLED_FOR_ORGANIZATION: "AI_DISABLED_FOR_ORGANIZATION"` to `API_ERROR_CODE` in `lib/api/errors.ts` (branch on `code`, never `message`).

`features/insights/components/run-digest-button.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RunDigestButton } from "./run-digest-button";

const mutate = vi.fn();
let error: { status: number; code: string; message: string } | null = null;
vi.mock("@/features/insights/hooks/use-digests", () => ({
  useRunDigest: () => ({ mutate, isPending: false, error }),
  useLatestDigest: () => ({ data: undefined }),
}));

describe("RunDigestButton", () => {
  it("posts on click", async () => {
    render(<RunDigestButton sinceLocalDate={null} />);
    await userEvent.click(screen.getByRole("button", { name: /generate now/i }));
    expect(mutate).toHaveBeenCalled();
  });
  it("a 429 says the daily limit was reached, where the click happened", () => {
    error = { status: 429, code: "TOO_MANY_REQUESTS", message: "Too many" };
    render(<RunDigestButton sinceLocalDate="2026-09-12" />);
    expect(screen.getByRole("status")).toHaveTextContent(/three manual runs/i);
  });
  it("a disabled organization is pointed at Settings", () => {
    error = { status: 409, code: "AI_DISABLED_FOR_ORGANIZATION", message: "off" };
    render(<RunDigestButton sinceLocalDate={null} />);
    expect(screen.getByRole("status")).toHaveTextContent(/Settings/);
  });
});
```

`features/insights/components/digest-history.tsx` — a list of `DigestSummary` rows (date via `formatDate(localDate, timezone)`, status pill, headline text) each wrapped in `<Link href={ROUTES.insight(d.id)}>` on the date cell, using `useDigests(page, 10)` with a simple previous/next; empty state "No earlier digests".

`features/insights/components/numbers-behind.tsx` — a `<details>` element titled "The numbers behind this" rendering the pack's headline figures with `formatMoney(n, currency)`: today's revenue/count/cash/credit/discounts/voids, the four comparison figures, top products (name · qty · revenue), sellers, outstanding/overdue, top overdue rows, low stock and velocity rows. Plain figures, no prose.

`features/insights/components/insights-screen.tsx`:

```tsx
"use client";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorCard } from "@/components/shared/error-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useLatestDigest } from "@/features/insights/hooks/use-digests";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import { useOrganizationProfile } from "@/features/organization/hooks/use-organization-profile";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { useCan } from "@/lib/auth/use-can";
import { DigestHistory } from "./digest-history";
import { DigestView } from "./digest-view";
import { NumbersBehind } from "./numbers-behind";
import { RunDigestButton } from "./run-digest-button";

export function InsightsScreen() {
  const latest = useLatestDigest();
  const { currency, timezone, isLoading: orgLoading } = useOrganization();
  const profile = useOrganizationProfile();
  const canRun = useCan(PERMISSIONS.ORGANIZATION_UPDATE);
  const hour = profile.data?.ai.hourLocal ?? 21;

  const header = (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="font-serif text-3xl text-foreground">Insights</h1>
        <p className="text-[13px] text-muted-foreground">Your evening digest, written from the day's figures.</p>
      </div>
      {canRun ? <RunDigestButton sinceLocalDate={latest.data?.localDate ?? null} /> : null}
    </div>
  );

  if (latest.isLoading || orgLoading) return <div className="flex flex-col gap-6">{header}<Skeleton className="h-[420px] rounded-[12px]" /></div>;

  if (latest.error && latest.error.status !== 404) return <div className="flex flex-col gap-6">{header}<ErrorCard error={latest.error} /></div>;

  return (
    <div className="flex flex-col gap-6">
      {header}
      {latest.data ? (
        <>
          <DigestView digest={latest.data} currency={currency} timezone={timezone} />
          <NumbersBehind pack={latest.data.pack} currency={currency} />
        </>
      ) : (
        <EmptyState
          title="No digest yet"
          description={`Your first one arrives at ${String(hour).padStart(2, "0")}:00 tonight${canRun ? ", or generate one now" : ""}.`}
        />
      )}
      <DigestHistory timezone={timezone} />
    </div>
  );
}
```

`features/insights/components/digest-detail.tsx` — `useDigest(id)`; 404 → `<EmptyState title="This digest was removed" />`; otherwise `<DigestView>` + `<NumbersBehind>`, with a `<ButtonLink variant="ghost" href={ROUTES.insights}>Back to Insights</ButtonLink>`.

Match `useCan`'s real import path (`lib/auth/use-can` or wherever `grep -rn "export function useCan"` says) and `EmptyState`/`ErrorCard` prop names to their files.

- [ ] **Step 4: Gate and commit**

```bash
bunx vitest run features/insights lib/auth && bunx tsc --noEmit && bunx biome check .
git add app/\(app\)/insights features/insights lib/api/errors.ts
git commit -m "feat(insights): the Insights page — latest digest, history, generate now"
```

---

### Task F4: The Overview strip

**Files:**
- Modify: `features/dashboard/types.ts`, `features/dashboard/components/overview.tsx`, `features/dashboard/components/section-links.test.tsx`
- Create: `features/dashboard/components/insights-section.tsx`

- [ ] **Step 1: Type** — in `features/dashboard/types.ts`:

```ts
/** `digest.section.ts`. Needs `reports:view`. `null` when no digest has been generated yet. */
export type DashboardDigestSection = {
  id: string;
  localDate: string;
  status: "complete" | "partial" | "failed";
  headline: string | null;
} | null;
```

and in `DashboardSections`: `digest: DashboardDigestSection;`.

- [ ] **Step 2: Test first** — add to `section-links.test.tsx`:

```tsx
  it("the insights strip opens the Insights page, and a failed night says so", () => {
    render(<InsightsSection section={{ id: "d1", localDate: "2026-09-12", status: "complete", headline: "A steady Saturday" }} timezone={TZ} />);
    expect(screen.getByRole("link", { name: /A steady Saturday/ })).toHaveAttribute("href", "/insights");

    render(<InsightsSection section={{ id: "d2", localDate: "2026-09-12", status: "failed", headline: null }} timezone={TZ} />);
    expect(screen.getByText(/could not be written/i)).toBeInTheDocument();
  });
```

- [ ] **Step 3: Component**

`features/dashboard/components/insights-section.tsx`:

```tsx
import { Sparkles } from "lucide-react";
import Link from "next/link";
import { ROUTES } from "@/config/routes";
import { SectionStrip } from "@/features/dashboard/components/section-strip";
import type { DashboardDigestSection } from "@/features/dashboard/types";
import { formatDate } from "@/lib/format/date";

/**
 * One line from last night's digest, and the way in. The strip links to the
 * Insights page rather than the digest's own id because "last night's" is
 * what the reader wants and the page always opens on it.
 */
export function InsightsSection({ section, timezone }: { section: DashboardDigestSection; timezone: string }) {
  return (
    <SectionStrip title="Insights · last night" actions={<Link href={ROUTES.insights} className="text-xs font-medium text-primary hover:underline">Open</Link>}>
      <div className="flex items-start gap-3 px-[18px] py-3">
        <Sparkles className="mt-0.5 size-4 flex-none text-primary" aria-hidden="true" />
        {section === null ? (
          <p className="text-[13px] text-muted-foreground">No digest yet. Turn it on under Settings → AI insights.</p>
        ) : section.headline ? (
          <div className="flex min-w-0 flex-col gap-0.5">
            <Link href={ROUTES.insights} className="truncate text-[13px] font-medium text-foreground hover:underline">{section.headline}</Link>
            <span className="font-mono text-[11px] text-muted-3">{formatDate(section.localDate, timezone)}{section.status === "partial" ? " · partial" : ""}</span>
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">Last night's digest could not be written. <Link href={ROUTES.insights} className="text-primary hover:underline">Generate one now</Link>.</p>
        )}
      </div>
    </SectionStrip>
  );
}
```

- [ ] **Step 4: Render it** — in `overview.tsx`, where the section components are placed, add next to the Staff/Projects band:

```tsx
{sections.digest !== undefined ? <InsightsSection section={sections.digest} timezone={timezone} /> : null}
```

(`undefined` = the section was not sent, i.e. no `reports:view`; `null` = sent, none generated.)

- [ ] **Step 5: Gate and commit**

```bash
bunx vitest run features/dashboard && bunx tsc --noEmit && bunx biome check .
git add features/dashboard
git commit -m "feat(overview): last night's insights strip"
```

---

## Self-review against the spec

- §11 route + nav after Reports + gate → F1/F3. Latest as three cards, honest `partial`/`failed`, history → F3. Generate now with polling, 429 copy, disabled → Settings, six states → F3. Detail page with "numbers behind" → F3. Settings form → F2. Overview strip via `dashboard.digest`, row links to the item rule → F4. Money/dates through the formatters; model text as text nodes (tested) → F3.
- Names: `digestKeys`, `useLatestDigest`, `useRunDigest`, `Digest`, `DigestSummary`, `DashboardDigestSection`, `AiSettings` defined once (F1) and imported by name in F2–F4.
- "Match the real prop names in file X" notes name the file; there are no TBDs.
