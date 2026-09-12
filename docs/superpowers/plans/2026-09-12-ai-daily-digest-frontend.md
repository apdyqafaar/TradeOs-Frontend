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
// GET /digests?page&limit               → { data: DigestSummary[], meta: PageMeta }   (no trace)
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
export const listDigests = (params: { page: number; limit: number }) => apiGetList<DigestSummary>(BASE, params);
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
export function useDigests(page: number, limit: number): UseQueryResult<{ data: DigestSummary[]; meta: PageMeta }, ApiError> {
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

Unchanged from the first plan: `features/settings/components/ai-form.tsx` (enable checkbox · language select over `AI_LANGUAGES` · closing-hour select shown with the business timezone · submits only changed fields · "Change at least one setting" · server field errors via `fieldErrorsFor`), its three tests (shows current settings and the timezone; submits only what changed; refuses an empty change), and the third tab in `settings-page.tsx`.

```bash
git commit -m "feat(settings): AI insights — enable, language, closing hour"
```

---

### Task F3: The Insights pages

**Files:** create `app/(app)/insights/page.tsx`, `app/(app)/insights/[id]/page.tsx`, `features/insights/components/{insights-screen,digest-view,digest-history,run-digest-button,trace-view,digest-detail}.tsx` + tests for `digest-view`, `run-digest-button`, `trace-view`.

- [ ] **Step 1: Pages** — as in the first plan (`InsightsScreen`; `[id]` awaits `params` and renders `<DigestDetail id={id} />`), both opening with `requirePageAccess()`.

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

- [ ] **Step 3: `digest-view.tsx`** — five `Card`s (Sales · Debts · Stock · Team & projects · What to do tomorrow) following the first plan's `Card`/`Lines`/`Missing` helpers; each card renders its section's `headline` in the serif, its list fields as `<Lines>`, `accountsToChase`/`reorder` as "**name** — why" rows, `actions` with the priority/kind chip; a `Missing what="team"` line for a `null` section; and above the cards a status line: `formatDate(generatedAt, timezone)` plus, when `stoppedBy !== "complete"`, *"Stopped early ({stoppedBy}) — the sections below are what the analysts finished."* All strings as text nodes.

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

- [ ] **Step 5: `run-digest-button.tsx` + test, `digest-history.tsx`, `insights-screen.tsx`, `digest-detail.tsx`** — as in the first plan, with `NumbersBehind` replaced by `<TraceView trace={digest.trace} />` under a heading "What the analysts looked at" on both the latest view and the detail page, and the digest's `usage.calls` / `usage.routerCalls` / `trace.length` shown in one muted mono line ("9 analyst turns · 4 routing decisions · 14 tool calls").

- [ ] **Step 6: Gate and commit**

```bash
bunx vitest run features/insights && bunx tsc --noEmit && bunx biome check .
git add app/\(app\)/insights features/insights
git commit -m "feat(insights): the Insights page — five sections, the analysts' trace, history, generate now"
```

---

### Task F4: The Overview strip

Unchanged from the first plan: `DashboardDigestSection` type, `InsightsSection` rendering last night's headline linking to `/insights` (or "could not be written" with a link to generate), rendered in `overview.tsx` when `sections.digest !== undefined`, and the case in `section-links.test.tsx`.

```bash
git commit -m "feat(overview): last night's insights strip"
```

---

## Self-review against the spec

- §11 route/nav/gate → F1/F3; five cards with honest `partial`/`stoppedBy` → F3 (tested); "What the analysts looked at" as the trace, parameters and results as text → F3 (tested with a markup string); history, Generate now with polling and the three messages, six states → F3; settings → F2; Overview strip → F4.
- Names defined once in F1 (`Digest`, `DigestSummary`, `ToolTrace`, `StoppedBy`, `digestKeys`, the hooks) and imported by name in F2–F4.
