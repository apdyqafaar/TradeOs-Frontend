# AI Daily Digest — Frontend Implementation Plan (five sections + tool trace)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An **Insights** page that shows the latest AI digest as five cards (Sales · Debts · Stock · Team & projects · What to do tomorrow) with **"What the analysts looked at"** — the tool trace — its history and a "Generate now" button; an "AI insights" settings form; and an Overview strip.

**Architecture:** One new feature slice `features/insights/` in the repo's `page → components → hooks → services → lib/api/client` layering, plus small additions to `features/organization` (the `ai` settings), `features/settings` (the form) and `features/dashboard` (the strip). Model-written text is rendered as text nodes only; the trace shows the parameters each analyst used and the capped results it saw, as data.

**Tech Stack:** Next.js 16 App Router · React 19 + React Compiler · TanStack Query v5 · axios (`lib/api/client`) · zod v4 · Tailwind v4 · shadcn base-nova on `@base-ui/react` (`render`, never `asChild`) · vitest + happy-dom.

**Spec:** `../Backend/docs/superpowers/specs/2026-09-12-ai-daily-digest-design.md` (revised; §8 API, §11 frontend). The backend plan (`../Backend/docs/superpowers/plans/2026-09-12-ai-daily-digest-backend.md`) fixes the wire shapes quoted below; both repos build in parallel because every frontend test mocks at the axios adapter.

## Global Constraints

- Pages are Server Components opening with `const { permitted } = await requirePageAccess(); if (!permitted) return <ForbiddenScreen />;` — `require-page-access.test.ts` fails any page that does not.
- **`docs/API-ROUTES.md` first**: a service may only call a listed path.
- `useQuery`/`useMutation` only in `hooks/`; keys from `createQueryKeys(scope)`; invalidate through the key object.
- Money via `formatMoney(amount, currencyCode)`; dates via `lib/format/date.ts` with the **business** timezone from `useOrganization()`.
- Links styled as buttons use `<ButtonLink>`; `button-as-link.test.ts` fails `<Button render={<Link/>}>`.
- Six list states; domain codes (`AI_NOT_CONFIGURED`, `AI_DISABLED_FOR_ORGANIZATION`, 429) shown where the action was taken.
- **Model text is data**: text nodes only — never `dangerouslySetInnerHTML`, never markdown. Trace `input`/`output` rendered as plain JSON text.
- Gate before "done": `bunx tsc --noEmit`, `bunx biome check .`, `bunx vitest run`.

## Execution waves

| Wave | Tasks |
|---|---|
| 0 | **F1** — routes, nav, API rows, types, keys, services, hooks. Alone. |
| 1 (parallel) | **F2** settings form · **F3** Insights pages · **F4** Overview strip |

## Wire shapes (from the backend plan)

```ts
// GET /digests/latest, GET /digests/:id  → Digest (with trace)
// GET /digests?page&limit               → HTTP envelope { data: DigestSummary[], meta } (no trace);
//                                        after apiGetList the client sees Paginated<T> = { items, meta }
// POST /digests/run                     → 202 { localDate }  · 503 AI_NOT_CONFIGURED · 409 AI_DISABLED_FOR_ORGANIZATION · 429 · 403
// PATCH /organizations/current/ai       → Organization (with ai)
// GET /dashboard → sections.digest: { id, localDate, status, headline: string|null } | null
```

## File structure

```
docs/API-ROUTES.md                                   (modify) 5 rows
config/routes.ts                                     (modify) ROUTES.insights/insight, nav, ROUTE_PERMISSIONS
lib/api/errors.ts                                    (modify) two API_ERROR_CODE entries
features/insights/types.ts · keys.ts · services/digest.service.ts (+test) · hooks/use-digests.ts
features/organization/types.ts · schemas/organization.schema.ts · services/organization.service.ts · hooks/use-organization-mutations.ts (modify)

features/settings/components/ai-form.tsx (+test) · settings-page.tsx (modify)          F2
app/(app)/insights/page.tsx · app/(app)/insights/[id]/page.tsx                          F3
features/insights/components/insights-screen.tsx · digest-view.tsx (+test) · digest-history.tsx · run-digest-button.tsx (+test) · trace-view.tsx (+test) · digest-detail.tsx
features/dashboard/types.ts · components/insights-section.tsx · overview.tsx · section-links.test.tsx   F4
```

---

### Task F1: Foundation

**Files:** modify `docs/API-ROUTES.md`, `config/routes.ts`, `lib/api/errors.ts`, `features/organization/{types,schemas/organization.schema,services/organization.service,hooks/use-organization-mutations}.ts`; create `features/insights/{types,keys}.ts`, `features/insights/services/digest.service.ts`, `features/insights/services/digest.service.test.ts`, `features/insights/hooks/use-digests.ts`.

**Produces:** `ROUTES.insights`, `ROUTES.insight(id)`; `API_ERROR_CODE.AI_NOT_CONFIGURED`, `.AI_DISABLED_FOR_ORGANIZATION`; types `Digest`, `DigestSummary`, `DigestStatus`, `StoppedBy`, `DigestSections`, `ToolTrace`, `AiSettings`, `AiLanguage`, `AI_LANGUAGES`, `AI_LANGUAGE_LABELS`; `digestKeys`; services `getLatestDigest`, `getDigest`, `listDigests`, `runDigest`, `updateAiSettings`; hooks `useLatestDigest`, `useDigest`, `useDigests`, `useRunDigest`, `useUpdateAiSettings`; `Organization.ai`.

- [ ] **Step 1: API rows** — in `docs/API-ROUTES.md`:

```
| PATCH | `/organizations/current/ai` | organization:update |
| GET | `/digests` | reports:view |
| GET | `/digests/latest` | reports:view |
| GET | `/digests/:id` | reports:view |
| POST | `/digests/run` | organization:update |
```

- [ ] **Step 2: Routes, nav, error codes** — `config/routes.ts`: after `reportsStaff`: `insights: "/insights",` and `insight: (id: string) => \`/insights/${id}\`,`; import `Sparkles` from `lucide-react`; in the **Main** group after Reports: `{ label: "Insights", href: ROUTES.insights, icon: Sparkles, permission: PERMISSIONS.REPORTS_VIEW },`; in `ROUTE_PERMISSIONS`: `[ROUTES.insights]: PERMISSIONS.REPORTS_VIEW,`. In `lib/api/errors.ts` add to `API_ERROR_CODE`: `AI_NOT_CONFIGURED: "AI_NOT_CONFIGURED",` and `AI_DISABLED_FOR_ORGANIZATION: "AI_DISABLED_FOR_ORGANIZATION",`.

- [ ] **Step 3: Organization `ai`** — `features/organization/types.ts`:

```ts
export const AI_LANGUAGES = ["en", "so", "sw", "am"] as const;
export type AiLanguage = (typeof AI_LANGUAGES)[number];
export const AI_LANGUAGE_LABELS: Record<AiLanguage, string> = { en: "English", so: "Somali", sw: "Swahili", am: "Amharic" };
/** Mirrors `Organization.ai` (Backend spec §4.1). */
export interface AiSettings { enabled: boolean; language: AiLanguage; hourLocal: number }
```

and `ai: AiSettings;` inside `Organization` after `status`. `schemas/organization.schema.ts`:

```ts
import { AI_LANGUAGES } from "@/features/organization/types";
export const updateAiSettingsSchema = z
  .object({ enabled: z.boolean().optional(), language: z.enum(AI_LANGUAGES).optional(), hourLocal: z.number().int().min(0).max(23).optional() })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: "Change at least one setting" });
export type UpdateAiSettingsInput = z.infer<typeof updateAiSettingsSchema>;
```

`services/organization.service.ts`: `export const updateAiSettings = (input: UpdateAiSettingsInput): Promise<Organization> => apiPatch<Organization>("/organizations/current/ai", input);`

`hooks/use-organization-mutations.ts`:

```ts
export function useUpdateAiSettings(): UseMutationResult<Organization, ApiError, UpdateAiSettingsInput> {
  const queryClient = useQueryClient();
  return useMutation<Organization, ApiError, UpdateAiSettingsInput>({
    mutationFn: updateAiSettings,
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: organizationKeys.all }); },
  });
}
```

- [ ] **Step 4: `features/insights/types.ts`**

```ts
import type { AiLanguage } from "@/features/organization/types";

export type DigestStatus = "complete" | "partial" | "failed";
export type StoppedBy = "complete" | "budget" | "hops" | "error";
export type SectionKey = "sales" | "debts" | "stock" | "team" | "recommendations";

export interface SalesSection { headline: string; points: string[]; comparison: { vsLastWeek: string; monthToDate: string }; anomalies: string[] }
export interface DebtsSection { headline: string; points: string[]; accountsToChase: { customer: string; why: string }[] }
export interface StockSection { headline: string; points: string[]; reorder: { product: string; why: string }[] }
export interface TeamSection { headline: string; people: string[]; projects: string[] }
export interface RecommendationAction { priority: "high" | "medium" | "low"; kind: "chase" | "restock" | "review" | "promote" | "project" | "other"; text: string }
export interface RecommendationsSection { actions: RecommendationAction[]; warnings: string[] }
export interface DigestSections {
  sales: SalesSection | null; debts: DebtsSection | null; stock: StockSection | null; team: TeamSection | null; recommendations: RecommendationsSection | null;
}

/** One tool call an analyst made — parameters, a one-line summary, and the capped result it saw. */
export interface ToolTrace { seq: number; agent: string; tool: string; input: Record<string, unknown>; summary: string; output: unknown; ms: number }

export interface DigestSummary {
  id: string; localDate: string; timezone: string; language: AiLanguage; model: string;
  trigger: "cron" | "manual"; requestedBy?: string;
  status: DigestStatus; stoppedBy: StoppedBy;
  sections: DigestSections;
  errors: { section: SectionKey; message: string }[];
  usage: { inputTokens: number; outputTokens: number; calls: number; routerCalls: number; costUsd: number };
  generatedAt: string; createdAt: string;
}
export interface Digest extends DigestSummary { trace: ToolTrace[] }
export interface RunDigestResult { localDate: string }
```

- [ ] **Step 5: Keys, service, test, hooks**

`features/insights/keys.ts`:

```ts
import { createQueryKeys } from "@/lib/query/keys";
const base = createQueryKeys("digests");
export const digestKeys = { ...base, latest: () => ["digests", "latest"] as const };
```

`features/insights/services/digest.service.ts`:

```ts
import type { Digest, DigestSummary, RunDigestResult } from "@/features/insights/types";
import { apiGet, apiGetList, apiPost } from "@/lib/api/client";
const BASE = "/digests";
export const getLatestDigest = (): Promise<Digest> => apiGet<Digest>(`${BASE}/latest`);
export const getDigest = (id: string): Promise<Digest> => apiGet<Digest>(`${BASE}/${id}`);
export const listDigests = (params: { page: number; limit: number }): Promise<Paginated<DigestSummary>> =>
  // `apiGetList(url, config)` takes an AxiosRequestConfig, so params go in `{ params }`,
  // and it returns `Paginated<T>` = `{ items, meta }` — NOT `{ data, meta }`. This has
  // been written wrong here before; see the note in announcement.service.ts.
  apiGetList<DigestSummary>(BASE, { params });
/** 202 — the digest lands about a minute later; callers poll `getLatestDigest`. */
export const runDigest = (): Promise<RunDigestResult> => apiPost<RunDigestResult>(`${BASE}/run`, {});
```

`digest.service.test.ts` — copy the `replyWith` adapter harness from `features/reports/services/report.service.test.ts`, then three cases: `runDigest` posts to `/digests/run` and unwraps the 202 envelope to `{ localDate }`; a 429 with `x-request-id` becomes an `ApiError` with `status 429` and that `requestId`; `getLatestDigest` and `getDigest("d1")` hit `/digests/latest` and `/digests/d1`.

`features/insights/hooks/use-digests.ts`:

```ts
"use client";
import { type UseMutationResult, type UseQueryResult, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { digestKeys } from "@/features/insights/keys";
import { getDigest, getLatestDigest, listDigests, runDigest } from "@/features/insights/services/digest.service";
import type { Digest, DigestSummary, RunDigestResult } from "@/features/insights/types";
import type { ApiError } from "@/lib/api/errors";
import type { PageMeta } from "@/lib/api/types";

/** A 404 is "no digest yet" — an answer. `retry: false` says so out loud. */
export function useLatestDigest(options: { pollMs?: number } = {}): UseQueryResult<Digest, ApiError> {
  return useQuery<Digest, ApiError>({ queryKey: digestKeys.latest(), queryFn: getLatestDigest, refetchInterval: options.pollMs ?? false, retry: false });
}
export function useDigest(id: string): UseQueryResult<Digest, ApiError> {
  return useQuery<Digest, ApiError>({ queryKey: digestKeys.detail(id), queryFn: () => getDigest(id) });
}
export function useDigests(page: number, limit: number): UseQueryResult<Paginated<DigestSummary>, ApiError> {
  return useQuery({ queryKey: digestKeys.list({ page, limit }), queryFn: () => listDigests({ page, limit }) });
}
export function useRunDigest(): UseMutationResult<RunDigestResult, ApiError, void> {
  const queryClient = useQueryClient();
  return useMutation<RunDigestResult, ApiError, void>({
    mutationFn: () => runDigest(),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: digestKeys.all }); },
  });
}
```

- [ ] **Step 6: Gate and commit**

```bash
bunx tsc --noEmit && bunx biome check . && bunx vitest run features/insights features/organization config
git add docs/API-ROUTES.md config/routes.ts lib/api/errors.ts features/insights features/organization
git commit -m "feat(insights): routes, types, keys, services and hooks for the AI digest"
```

---

### Task F2: Settings → "AI insights" form

**Files:**
- Create: `features/settings/components/ai-form.tsx`, `features/settings/components/ai-form.test.tsx`
- Modify: `features/settings/components/settings-page.tsx`

**Interfaces:** consumes `useOrganizationProfile()` (returns the `Organization`, whose `ai` F1 added), `useUpdateAiSettings()` (F1), `AI_LANGUAGES` / `AI_LANGUAGE_LABELS` / `AiLanguage` and `updateAiSettingsSchema` / `UpdateAiSettingsInput` (F1), and the primitives in `form-primitives.tsx`.

**The real primitive APIs — read them, they are not what you would guess:**

- `SettingsPanel({ title?, description?, action?, children, className? })`.
- **`Field` takes its control as a RENDER PROP, not as children:**
  `Field({ id, label, hint?, error?, children: (props: { id, "aria-invalid", "aria-describedby" }) => ReactNode })`.
  Spread those props onto the control — that wiring is the only thing connecting the error message to a screen reader.
- `CONTROL` and `SELECT_CONTROL` are className strings. `InfoNote`, `AlertNote`, `SuccessNote` take children.
- The tab strip is `nuqs`-driven: `SETTINGS_TABS` is a `readonly` tuple fed to `parseAsStringLiteral(...).withDefault("business")`, and `TAB_LABELS` is a `Record` over it. Adding a tab means adding to both, and the panel renders exactly one form — the inactive one is unmounted on purpose, so each form seeds itself from the server on mount.

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
    data: {
      id: "o1",
      name: "Shop",
      timezone: "Africa/Addis_Ababa",
      ai: { enabled: false, language: "en", hourLocal: 21 },
    },
  }),
}));
vi.mock("@/features/organization/hooks/use-organization-mutations", () => ({
  useUpdateAiSettings: () => ({ mutate, isPending: false, isSuccess: false, error: null }),
}));

describe("AiForm", () => {
  it("shows the current settings, and names the business timezone beside the hour", () => {
    render(<AiForm />);
    expect(screen.getByRole("checkbox", { name: /daily digest/i })).not.toBeChecked();
    expect(screen.getByRole("combobox", { name: /language/i })).toHaveValue("en");
    expect(screen.getByRole("combobox", { name: /closing hour/i })).toHaveValue("21");
    expect(screen.getByText(/Africa\/Addis_Ababa/)).toBeInTheDocument();
  });

  it("submits only the fields that changed", async () => {
    render(<AiForm />);
    await userEvent.click(screen.getByRole("checkbox", { name: /daily digest/i }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /language/i }), "so");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(mutate).toHaveBeenCalledWith({ enabled: true, language: "so" }, expect.anything());
  });

  it("refuses to submit when nothing changed, and says why", async () => {
    render(<AiForm />);
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText(/change at least one/i)).toBeInTheDocument();
  });

  it("drops a field from the draft when it is set back to its saved value", async () => {
    // Toggling on and off again is not a change. Without this, the form posts
    // `{ enabled: false }` and the server writes a value it already held.
    render(<AiForm />);
    const toggle = screen.getByRole("checkbox", { name: /daily digest/i });
    await userEvent.click(toggle);
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(mutate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `bunx vitest run features/settings/components/ai-form.test.tsx` → module not found.

- [ ] **Step 3: The form** — `features/settings/components/ai-form.tsx`:

```tsx
"use client";

import { useId, useState } from "react";
import { ErrorCard } from "@/components/shared/error-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useUpdateAiSettings } from "@/features/organization/hooks/use-organization-mutations";
import { useOrganizationProfile } from "@/features/organization/hooks/use-organization-profile";
import {
  updateAiSettingsSchema,
  type UpdateAiSettingsInput,
} from "@/features/organization/schemas/organization.schema";
import {
  AI_LANGUAGE_LABELS,
  AI_LANGUAGES,
  type AiLanguage,
} from "@/features/organization/types";
import { fieldErrorsFor } from "@/lib/api/errors";
import {
  AlertNote,
  Field,
  InfoNote,
  SELECT_CONTROL,
  SettingsPanel,
  SuccessNote,
} from "./form-primitives";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const twoDigits = (n: number) => String(n).padStart(2, "0");

/** Drops a key instead of storing it, so "changed back" is the same as "unchanged". */
function withoutKey<K extends keyof UpdateAiSettingsInput>(
  draft: UpdateAiSettingsInput,
  key: K,
): UpdateAiSettingsInput {
  const { [key]: _dropped, ...rest } = draft;
  return rest;
}

/**
 * The AI insights settings (Backend spec §4.1).
 *
 * **Only the fields that differ from what the server holds are sent.** The
 * endpoint is a partial PATCH, so posting an unchanged `language` beside a
 * changed `enabled` would be harmless — but it would also make the one log
 * line the server writes per settings change unable to answer "what did they
 * actually change?".
 */
export function AiForm() {
  const profile = useOrganizationProfile();
  const update = useUpdateAiSettings();
  const enabledId = useId();
  const languageId = useId();
  const hourId = useId();
  const [draft, setDraft] = useState<UpdateAiSettingsInput>({});
  const [issue, setIssue] = useState<string | null>(null);

  if (profile.isLoading || !profile.data) {
    return <Skeleton className="h-[280px] rounded-[10px]" />;
  }

  const saved = profile.data.ai;
  const value = { ...saved, ...draft };

  const set = <K extends keyof UpdateAiSettingsInput>(
    key: K,
    next: NonNullable<UpdateAiSettingsInput[K]>,
  ) => {
    setIssue(null);
    setDraft((current) =>
      next === saved[key] ? withoutKey(current, key) : { ...current, [key]: next },
    );
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = updateAiSettingsSchema.safeParse(draft);
    if (!parsed.success) {
      setIssue(parsed.error.issues[0]?.message ?? "Change at least one setting");
      return;
    }
    update.mutate(parsed.data, { onSuccess: () => setDraft({}) });
  };

  const fieldErrors = update.error ? fieldErrorsFor(update.error) : {};
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;

  return (
    <SettingsPanel
      title="AI insights"
      description="Every evening, four analysts read the day's figures and write you a short digest: sales, debts, stock, the team, and what to do tomorrow."
    >
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <Field id={enabledId} label="Daily digest">
          {(props) => (
            <label className="flex items-center gap-3 text-[13px] text-foreground">
              <input
                {...props}
                type="checkbox"
                checked={value.enabled}
                onChange={(event) => set("enabled", event.target.checked)}
                className="size-4 accent-primary"
              />
              Generate a digest every evening
            </label>
          )}
        </Field>

        <Field id={languageId} label="Language" error={fieldErrors.language}>
          {(props) => (
            <select
              {...props}
              className={SELECT_CONTROL}
              value={value.language}
              onChange={(event) => set("language", event.target.value as AiLanguage)}
            >
              {AI_LANGUAGES.map((code) => (
                <option key={code} value={code}>
                  {AI_LANGUAGE_LABELS[code]}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field
          id={hourId}
          label="Closing hour"
          hint={`In your business timezone, ${profile.data.timezone}.`}
          error={fieldErrors.hourLocal}
        >
          {(props) => (
            <select
              {...props}
              className={SELECT_CONTROL}
              value={String(value.hourLocal)}
              onChange={(event) => set("hourLocal", Number(event.target.value))}
            >
              {HOURS.map((hour) => (
                <option key={hour} value={String(hour)}>
                  {twoDigits(hour)}:00
                </option>
              ))}
            </select>
          )}
        </Field>

        <InfoNote>
          The digest lands under Insights about a minute after the closing hour. It reads only your
          own sales, debts, stock and projects, and customer phone numbers are never sent to the
          model.
        </InfoNote>

        {issue ? <AlertNote>{issue}</AlertNote> : null}
        {update.error && !hasFieldErrors ? <ErrorCard error={update.error} /> : null}
        {update.isSuccess && Object.keys(draft).length === 0 ? (
          <SuccessNote>Saved.</SuccessNote>
        ) : null}

        <div className="flex justify-end">
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </SettingsPanel>
  );
}
```

Check `fieldErrorsFor`'s real return type in `lib/api/errors.ts` and `ErrorCard`'s prop name before using them; if `Field`'s render prop types conflict with a `<label>` wrapper for the checkbox, put the spread on the `<input>` and keep the label as its parent — the ids must still reach the input.

- [ ] **Step 4: The third tab** — in `settings-page.tsx`, add `"ai"` to `SETTINGS_TABS`, add `ai: "AI insights"` to `TAB_LABELS`, import `AiForm`, and change the panel line to:

```tsx
{tab === "business" ? <BusinessForm /> : tab === "currency" ? <CurrencyForm /> : <AiForm />}
```

- [ ] **Step 5: Gate and commit**

```bash
bunx vitest run features/settings && bunx tsc --noEmit && bunx biome check .
git add features/settings/components/ai-form.tsx features/settings/components/ai-form.test.tsx features/settings/components/settings-page.tsx
git commit -m "feat(settings): AI insights — enable, language, closing hour"
```

### Task F3: The Insights pages

**Files:** create `app/(app)/insights/page.tsx`, `app/(app)/insights/[id]/page.tsx`, `features/insights/components/{insights-screen,digest-view,digest-history,run-digest-button,trace-view,digest-detail}.tsx` + tests for `digest-view`, `run-digest-button`, `trace-view`.

- [ ] **Step 1: Pages** — both open with `requirePageAccess()`.

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

- [ ] **Step 2: Failing view test** — `digest-view.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Digest } from "@/features/insights/types";
import { DigestView } from "./digest-view";

const digest = (overrides: Partial<Digest> = {}): Digest => ({
  id: "d1", localDate: "2026-09-12", timezone: "Africa/Addis_Ababa", language: "en", model: "m", trigger: "cron",
  status: "complete", stoppedBy: "complete",
  sections: {
    sales: { headline: "A steady Saturday", points: ["Cooking oil led"], comparison: { vsLastWeek: "down 18%", monthToDate: "6% ahead" }, anomalies: ["One void of ETB 4,000"] },
    debts: { headline: "Credit crept up", points: ["Juma Kiosk fell overdue"], accountsToChase: [{ customer: "Hodan Traders", why: "ETB 12,000, 34 days" }] },
    stock: { headline: "Two lines thin", points: ["Bar soap sold out at 14:00"], reorder: [{ product: "AA batteries 4pk", why: "3 days left" }] },
    team: { headline: "Amina carried the till", people: ["Amina: 38 sales"], projects: ["Solar install due Tuesday, 40%"] },
    recommendations: { actions: [{ priority: "high", kind: "chase", text: "Call Hodan Traders" }], warnings: ["Batteries run out in 3 days"] },
  },
  errors: [], trace: [], usage: { inputTokens: 1, outputTokens: 1, calls: 9, routerCalls: 4, costUsd: 0.08 },
  generatedAt: "2026-09-12T18:06:00.000Z", createdAt: "2026-09-12T18:06:00.000Z", ...overrides,
});

describe("DigestView", () => {
  it("renders five cards from the sections", () => {
    render(<DigestView digest={digest()} timezone="Africa/Addis_Ababa" />);
    for (const text of ["A steady Saturday", "Hodan Traders", "AA batteries 4pk", "Amina: 38 sales", "Call Hodan Traders"]) {
      expect(screen.getByText(new RegExp(text))).toBeInTheDocument();
    }
  });
  it("a partial digest names the missing section and why the run stopped", () => {
    render(<DigestView digest={digest({ status: "partial", stoppedBy: "budget", sections: { ...digest().sections, team: null }, errors: [{ section: "team", message: "not submitted before the run stopped (budget)" }] })} timezone="Africa/Addis_Ababa" />);
    expect(screen.getByText(/team section could not be written/i)).toBeInTheDocument();
    expect(screen.getByText(/stopped early.*budget/i)).toBeInTheDocument();
  });
  it("model text is text, never markup", () => {
    render(<DigestView digest={digest({ sections: { ...digest().sections, sales: { ...digest().sections.sales!, headline: "<img src=x onerror=alert(1)>" } } })} timezone="Africa/Addis_Ababa" />);
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});
```

- [ ] **Step 3: `digest-view.tsx`** — five `Card`s (Sales · Debts · Stock · Team & projects · What to do tomorrow) built from the `Card`/`Lines`/`Missing` helpers below; each card renders its section's `headline` in the serif, its list fields as `<Lines>`, `accountsToChase`/`reorder` as "**name** — why" rows, `actions` with the priority/kind chip; a `Missing what="team"` line for a `null` section; and above the cards a status line: `formatDate(generatedAt, timezone)` plus, when `stoppedBy !== "complete"`, *"Stopped early ({stoppedBy}) — the sections below are what the analysts finished."* All strings as text nodes.

The `Card` / `Missing` / `Lines` helpers, in full:

```tsx
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
```


- [ ] **Step 4: `trace-view.tsx` + test** — "What the analysts looked at":

```tsx
import type { ToolTrace } from "@/features/insights/types";

/**
 * The audit trail: which questions each analyst asked, in order, and what it
 * was shown. Parameters and results are rendered as JSON text — never
 * interpreted — so a product named like an instruction is just a string here.
 */
export function TraceView({ trace }: { trace: ToolTrace[] }) {
  if (trace.length === 0) return <p className="text-[13px] text-muted-foreground">No tool calls were recorded for this digest.</p>;
  return (
    <ol className="flex flex-col divide-y divide-border rounded-[12px] border border-border bg-card">
      {trace.map((t) => (
        <li key={t.seq} className="flex flex-col gap-1 px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px]">
            <span className="font-mono text-[11px] text-muted-3">{t.seq}</span>
            <span className="font-medium text-foreground">{t.agent}</span>
            <span className="font-mono text-xs text-primary">{t.tool}</span>
            <span className="text-muted-foreground">{t.summary}</span>
            <span className="ml-auto font-mono text-[11px] text-muted-3">{t.ms} ms</span>
          </div>
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">Parameters and result</summary>
            <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-[11px] leading-relaxed text-foreground">
              {JSON.stringify({ input: t.input, output: t.output }, null, 2)}
            </pre>
          </details>
        </li>
      ))}
    </ol>
  );
}
```

`trace-view.test.tsx`: renders agent, tool and summary for two rows in order; an `output` string containing `<b>bold</b>` appears as text and the document has no `<b>`; empty trace shows the "No tool calls" line.

- [ ] **Step 5: `run-digest-button.tsx` + test, `digest-history.tsx`, `insights-screen.tsx`, `digest-detail.tsx`**

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

`NumbersBehind` no longer exists: everywhere the text below rendered it, render `<TraceView trace={digest.trace} />` under a heading "What the analysts looked at", with no `pack` prop, and beside it one muted mono line of `usage.calls` / `usage.routerCalls` / `trace.length` ("9 analyst turns · 4 routing decisions · 14 tool calls").

`features/insights/components/digest-history.tsx` — a list of `DigestSummary` rows (date via `formatDate(localDate, timezone)`, status pill, headline text) each wrapped in `<Link href={ROUTES.insight(d.id)}>` on the date cell, using `useDigests(page, 10)` with a simple previous/next; empty state "No earlier digests".


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

- [ ] **Step 6: Gate and commit**

```bash
bunx vitest run features/insights && bunx tsc --noEmit && bunx biome check .
git add app/\(app\)/insights features/insights
git commit -m "feat(insights): the Insights page — five sections, the analysts' trace, history, generate now"
```

---

### Task F4: The Overview strip

**Files:**
- Modify: `features/dashboard/types.ts`, `features/dashboard/components/overview.tsx`, `features/dashboard/components/section-links.test.tsx`
- Create: `features/dashboard/components/insights-section.tsx`

**Interfaces:** consumes `ROUTES.insights` (F1) and `SectionStrip` / `formatDate`. Produces `DashboardDigestSection` and `<InsightsSection>`.

**The distinction that drives the whole component:** the dashboard endpoint omits a section entirely when the caller lacks its permission, and sends `null` when the section exists but has nothing yet. So `sections.digest === undefined` means "no `reports:view`" and the strip must not render at all; `sections.digest === null` means "no digest generated yet" and the strip explains how to get one.

- [ ] **Step 1: Type** — in `features/dashboard/types.ts`:

```ts
/**
 * `digest.section.ts`. Needs `reports:view`.
 *
 * `null` when the shop has no digest yet — distinct from the key being absent,
 * which is how the API says the caller may not see this section at all.
 */
export type DashboardDigestSection = {
  id: string;
  localDate: string;
  status: "complete" | "partial" | "failed";
  headline: string | null;
} | null;
```

and add `digest: DashboardDigestSection;` to `DashboardSections`.

- [ ] **Step 2: Write the failing test** — append to `features/dashboard/components/section-links.test.tsx` (import `InsightsSection` at the top with the others):

```tsx
describe("InsightsSection", () => {
  it("opens the Insights page from last night's headline", () => {
    render(
      <InsightsSection
        timezone={TZ}
        section={{ id: "d1", localDate: "2026-09-12", status: "complete", headline: "A steady Saturday" }}
      />,
    );
    expect(screen.getByRole("link", { name: "A steady Saturday" })).toHaveAttribute(
      "href",
      "/insights",
    );
  });

  it("says so when last night's digest could not be written, and still offers a way in", () => {
    render(
      <InsightsSection
        timezone={TZ}
        section={{ id: "d2", localDate: "2026-09-12", status: "failed", headline: null }}
      />,
    );
    expect(screen.getByText(/could not be written/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /generate one now/i })).toHaveAttribute(
      "href",
      "/insights",
    );
  });

  it("points a shop with no digest yet at the setting that turns it on", () => {
    render(<InsightsSection timezone={TZ} section={null} />);
    expect(screen.getByText(/no digest yet/i)).toBeInTheDocument();
  });

  it("marks a partial digest as partial rather than passing it off as complete", () => {
    render(
      <InsightsSection
        timezone={TZ}
        section={{ id: "d3", localDate: "2026-09-12", status: "partial", headline: "Half a day" }}
      />,
    );
    expect(screen.getByText(/partial/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it to verify it fails** — `bunx vitest run features/dashboard/components/section-links.test.tsx` → module not found.

- [ ] **Step 4: The component** — `features/dashboard/components/insights-section.tsx`:

```tsx
import { Sparkles } from "lucide-react";
import Link from "next/link";
import { ROUTES } from "@/config/routes";
import { SectionStrip } from "@/features/dashboard/components/section-strip";
import type { DashboardDigestSection } from "@/features/dashboard/types";
import { formatDate } from "@/lib/format/date";

/**
 * One line from last night's digest, and the way in.
 *
 * It links to `/insights` rather than to the digest's own id: "last night's"
 * is what the reader wants, and that page always opens on the latest one, so
 * the link stays right tomorrow without the strip knowing anything new.
 *
 * A failed night says so. The alternative — rendering nothing — reads as "no
 * digest was due", which is a different and untrue statement.
 */
export function InsightsSection({
  section,
  timezone,
}: {
  section: DashboardDigestSection;
  timezone: string;
}) {
  return (
    <SectionStrip
      title="Insights · last night"
      info="Written each evening by the AI analysts from that day's sales, debts, stock and projects."
      actions={
        <Link
          href={ROUTES.insights}
          className="text-xs font-medium text-primary hover:underline"
        >
          Open
        </Link>
      }
    >
      <div className="flex items-start gap-3 px-[18px] py-3">
        <Sparkles className="mt-0.5 size-4 flex-none text-primary" aria-hidden="true" />
        {section === null ? (
          <p className="text-[13px] text-muted-foreground">
            No digest yet. Turn it on under Settings → AI insights.
          </p>
        ) : section.headline ? (
          <div className="flex min-w-0 flex-col gap-0.5">
            <Link
              href={ROUTES.insights}
              className="truncate text-[13px] font-medium text-foreground hover:underline"
            >
              {section.headline}
            </Link>
            <span className="font-mono text-[11px] text-muted-3">
              {formatDate(section.localDate, timezone)}
              {section.status === "partial" ? " · partial" : ""}
            </span>
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            Last night's digest could not be written.{" "}
            <Link href={ROUTES.insights} className="text-primary hover:underline">
              Generate one now
            </Link>
            .
          </p>
        )}
      </div>
    </SectionStrip>
  );
}
```

Confirm `SectionStrip`'s prop names (`title`, `info`, `actions`, `children`) and `formatDate`'s signature against their own files before relying on them.

- [ ] **Step 5: Render it** — in `overview.tsx`, beside the Staff/Projects band:

```tsx
{/* `undefined` = the API withheld the section (no `reports:view`). `null` =
    it was sent and there is no digest yet. Only the first means render nothing. */}
{sections.digest !== undefined ? (
  <InsightsSection section={sections.digest} timezone={timezone} />
) : null}
```

Match how the neighbouring sections read `sections` and `timezone` in that file — do not introduce a second way of getting them.

- [ ] **Step 6: Gate and commit**

```bash
bunx vitest run features/dashboard && bunx tsc --noEmit && bunx biome check .
git add features/dashboard/types.ts features/dashboard/components/insights-section.tsx features/dashboard/components/overview.tsx features/dashboard/components/section-links.test.tsx
git commit -m "feat(overview): last night's insights strip"
```

## Self-review against the spec

- §11 route/nav/gate → F1/F3; five cards with honest `partial`/`stoppedBy` → F3 (tested); "What the analysts looked at" as the trace, parameters and results as text → F3 (tested with a markup string); history, Generate now with polling and the three messages, six states → F3; settings → F2; Overview strip → F4.
- Names defined once in F1 (`Digest`, `DigestSummary`, `ToolTrace`, `StoppedBy`, `digestKeys`, the hooks) and imported by name in F2–F4.
