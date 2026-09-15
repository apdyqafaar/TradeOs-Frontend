import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Digest } from "@/features/insights/types";
import { InsightsScreen } from "./insights-screen";

/**
 * The three states `/insights` can be in on day one.
 *
 * `ai.enabled` defaults to **`false`** for every organization
 * (`Backend/src/db/models/organization.model.ts:38`), so "the feature is off"
 * is not an edge case — it is every tenant until someone opts in. This screen
 * used to read `ai.hourLocal` and never `ai.enabled`, so it promised a digest
 * at 21:00 to a shop that would never get one, and offered a Generate button
 * whose only possible answer was `409 AI_DISABLED_FOR_ORGANIZATION` — after
 * which the same screen told the reader to go and turn it on.
 *
 * `features/dashboard/components/section-links.test.tsx` asserts the same
 * three states on the Overview strip. The two screens describe one fact and
 * must never describe it differently.
 */

let latest: {
  data?: Digest;
  isPending: boolean;
  error: { status: number; message: string; requestId?: string } | null;
} = { data: undefined, isPending: false, error: null };

let profile: {
  isLoading: boolean;
  data?: { ai: { enabled: boolean; language: string; hourLocal: number } };
} = { isLoading: false, data: undefined };

let canRun = true;

let quota: {
  limit: number;
  used: number;
  remaining: number;
  resetsAt: string;
} | null = null;

vi.mock("@/features/insights/hooks/use-digests", () => ({
  useLatestDigest: () => latest,
  useDigests: () => ({
    data: undefined,
    error: null,
    isPending: false,
    refetch: vi.fn(),
  }),
  useRunDigest: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useDigestQuota: () => quota,
  quotaFromRefusal: () => null,
}));

// The screen reads the shop's main currency for its `unit: "money"` figures.
// The real hook opens a `useQuery`, which needs a QueryClientProvider this
// spec has no reason to mount.
vi.mock("@/features/organization/hooks/use-currency-config", () => ({
  useCurrencyConfig: () => ({
    mainCurrency: "ETB",
    exchangeCurrency: "USD",
    exchangeRate: 130,
    hasExchange: true,
    isLoading: false,
  }),
}));

vi.mock("@/features/organization/hooks/use-organization-profile", () => ({
  useOrganizationProfile: () => profile,
}));

vi.mock("@/features/auth/hooks/use-permission", () => ({
  useCan: () => canRun,
  usePermissions: () => ["*"],
}));

const digest = (): Digest => ({
  id: "d1",
  localDate: "2026-09-12",
  timezone: "Africa/Addis_Ababa",
  language: "en",
  model: "m",
  trigger: "cron",
  status: "complete",
  stoppedBy: "complete",
  sections: {
    sales: {
      headline: "A steady Saturday",
      points: [],
      comparison: { vsLastWeek: "flat", monthToDate: "flat" },
      anomalies: [],
    },
    debts: null,
    stock: null,
    team: null,
    recommendations: null,
  },
  errors: [],
  trace: [],
  usage: {
    inputTokens: 1,
    outputTokens: 1,
    calls: 9,
    routerCalls: 4,
    costUsd: 0.08,
  },
  generatedAt: "2026-09-12T18:06:00.000Z",
  createdAt: "2026-09-12T18:06:00.000Z",
});

beforeEach(() => {
  latest = { data: undefined, isPending: false, error: null };
  profile = { isLoading: false, data: undefined };
  canRun = true;
  quota = null;
});

describe("InsightsScreen — off, on-but-waiting, and present", () => {
  it("says the digest is off, promises no arrival time, and offers no Generate when ai.enabled is false", () => {
    profile = {
      isLoading: false,
      data: { ai: { enabled: false, language: "en", hourLocal: 21 } },
    };

    render(<InsightsScreen />);

    expect(screen.getByText(/evening digest is off/i)).toBeInTheDocument();
    // The promise that was simply false: nothing arrives tonight.
    expect(screen.queryByText(/21:00/)).not.toBeInTheDocument();
    expect(screen.queryByText(/tonight/i)).not.toBeInTheDocument();
    // A Generate button here can only answer 409 AI_DISABLED_FOR_ORGANIZATION.
    expect(
      screen.queryByRole("button", { name: /generate/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ai insights/i })).toHaveAttribute(
      "href",
      "/settings?tab=ai",
    );
  });

  it("offers a member who cannot open Settings a sentence rather than a link they get a ForbiddenScreen from", () => {
    canRun = false;
    profile = {
      isLoading: false,
      data: { ai: { enabled: false, language: "en", hourLocal: 21 } },
    };

    render(<InsightsScreen />);

    expect(screen.getByText(/evening digest is off/i)).toBeInTheDocument();
    // `/settings` is gated `organization:update` and enforced server-side
    // (`config/routes.ts`), so this link would land on <ForbiddenScreen/>.
    expect(
      screen.queryByRole("link", { name: /ai insights/i }),
    ).not.toBeInTheDocument();
  });

  it("names the arrival hour only once the feature is actually on", () => {
    profile = {
      isLoading: false,
      data: { ai: { enabled: true, language: "en", hourLocal: 20 } },
    };

    render(<InsightsScreen />);

    expect(screen.getByText(/arrives at 20:00/)).toBeInTheDocument();
    expect(screen.queryByText(/is off/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /generate/i }),
    ).toBeInTheDocument();
  });

  it("promises nothing at all while the AI settings are still unknown", () => {
    // The profile 403s for a role holding `reports:view` but not
    // `organization:view`. Neither "it is off" nor "it arrives at 21:00" is
    // known to be true, so the screen says neither.
    render(<InsightsScreen />);

    expect(screen.getByText(/no digest yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/tonight/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/is off/i)).not.toBeInTheDocument();
  });

  it("renders the digest itself once there is one", () => {
    profile = {
      isLoading: false,
      data: { ai: { enabled: true, language: "en", hourLocal: 21 } },
    };
    latest = { data: digest(), isPending: false, error: null };

    render(<InsightsScreen />);

    expect(screen.getAllByText("A steady Saturday").length).toBeGreaterThan(0);
    expect(screen.queryByText(/no digest yet/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/evening digest is off/i),
    ).not.toBeInTheDocument();
  });
});

describe("InsightsScreen — the paused state", () => {
  it("waits rather than announcing 'no digest yet' to a shop that has one", () => {
    // React Query's default `networkMode: "online"` with the browser offline:
    // `isPending: true, isFetching: false, data: undefined, error: null`.
    // `isLoading` is FALSE there, which is why this screen used to fall
    // straight through to the empty state. `DigestHistory` already used
    // `isPending`; all three components on this feature now agree.
    latest = { data: undefined, isPending: true, error: null };
    profile = {
      isLoading: false,
      data: { ai: { enabled: true, language: "en", hourLocal: 21 } },
    };

    render(<InsightsScreen />);

    expect(screen.queryByText(/no digest yet/i)).not.toBeInTheDocument();
    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  });
});

describe("InsightsScreen — the analysts' trace", () => {
  it("renders the shared audit block under the digest", () => {
    // The other half of the `<TraceSection>` extraction; `digest-detail.test.tsx`
    // asserts it on `/insights/:id`.
    profile = {
      isLoading: false,
      data: { ai: { enabled: true, language: "en", hourLocal: 21 } },
    };
    latest = { data: digest(), isPending: false, error: null };

    render(<InsightsScreen />);

    expect(
      screen.getByText(/what the analysts looked at/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/9 analyst turns · 4 routing decisions · 0 tool calls/),
    ).toBeInTheDocument();
  });
});

describe("InsightsScreen — while the AI settings are still in flight", () => {
  it("does not offer Generate before the profile has answered", () => {
    // `ai === null` means BOTH "the profile 403'd" and "it has not arrived
    // yet", and only the first of those is a reason to keep offering the
    // button. An owner of an AI-off shop opening `/insights` cold on a slow
    // connection could click Generate inside the load window, get a
    // 409 AI_DISABLED_FOR_ORGANIZATION, and read "Turn on the daily digest in
    // Settings → AI insights first" beside a screen that then resolved to
    // "The daily digest is off" — finding 1's self-contradiction narrowed to
    // the load window rather than removed.
    //
    // `isLoading`, not `isPending`: this query is disabled until the session
    // reports an organization, and `isPending` is true for ever in that state,
    // which would hide the button permanently rather than briefly.
    profile = { isLoading: true, data: undefined };

    render(<InsightsScreen />);

    expect(
      screen.queryByRole("button", { name: /generate/i }),
    ).not.toBeInTheDocument();
  });

  it("offers it again once the profile answers, even if it answered with nothing", () => {
    // A `reports:view`-only custom role gets a 403 from
    // `GET /organizations/current` (gated `organization:view`), so `ai` stays
    // null for good. Unknown is not off, and the button's own 409 branch says
    // so clearly if it turns out to be.
    profile = { isLoading: false, data: undefined };

    render(<InsightsScreen />);

    expect(
      screen.getByRole("button", { name: /generate/i }),
    ).toBeInTheDocument();
  });
});

describe("InsightsScreen — the header says which window the digest covers", () => {
  it("prints the range ending on the last day INCLUDED, not on the exclusive `to`", () => {
    // `period.to` is the instant one calendar day after the last day covered,
    // so a run over 08–14 September carries local midnight opening the 15th.
    // A header printing it raw reads "08 – 15 Sep" — plausible, and wrong by
    // one, on every range on the page.
    profile = {
      isLoading: false,
      data: { ai: { enabled: true, language: "en", hourLocal: 21 } },
    };
    latest = {
      data: {
        ...digest(),
        localDate: "2026-09-14",
        timezone: "Africa/Mogadishu",
        generatedAt: "2026-09-14T18:02:00.000Z",
        period: {
          preset: "last7",
          from: "2026-09-07T21:00:00.000Z",
          to: "2026-09-14T21:00:00.000Z",
        },
      },
      isPending: false,
      error: null,
    };

    render(<InsightsScreen />);

    expect(
      screen.getByText(/Last 7 days · 08 – 14 Sep 2026/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/15 Sep/)).toBeNull();
  });

  it("falls back to the day it was written for a row with no window recorded", () => {
    // `publicDigest` omits `period` for every row written before 2026-09-15
    // rather than back-filling "today", so a client cannot tell a guess from a
    // fact. `formatLocalDate`, not `formatDate`: the latter re-parses a bare
    // `yyyy-MM-dd` as UTC midnight and prints the day BEFORE for any shop west
    // of Greenwich, which has shipped three times in this repo.
    profile = {
      isLoading: false,
      data: { ai: { enabled: true, language: "en", hourLocal: 21 } },
    };
    latest = { data: digest(), isPending: false, error: null };

    render(<InsightsScreen />);

    expect(screen.getByText(/12 Sep 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/11 Sep 2026/)).toBeNull();
  });
});

describe("InsightsScreen — one Generate control, and the allowance beside it", () => {
  it("renders exactly one Generate button when there is a digest", () => {
    // Two would each own their own `pending` state and give-up timer, so one
    // would sit at "Generate now" while the other said "Generating 0:23" about
    // the same run — and the allowance line would print twice.
    profile = {
      isLoading: false,
      data: { ai: { enabled: true, language: "en", hourLocal: 21 } },
    };
    latest = { data: digest(), isPending: false, error: null };
    quota = {
      limit: 2,
      used: 1,
      remaining: 1,
      resetsAt: "2026-09-13T18:00:00.000Z",
    };

    render(<InsightsScreen />);

    expect(screen.getAllByRole("button", { name: /generate/i })).toHaveLength(
      1,
    );
    expect(screen.getAllByText("1 of 2 left today")).toHaveLength(1);
  });

  it("renders exactly one on the empty screen too, inside the panel explaining why", () => {
    profile = {
      isLoading: false,
      data: { ai: { enabled: true, language: "en", hourLocal: 21 } },
    };
    quota = {
      limit: 2,
      used: 0,
      remaining: 2,
      resetsAt: "2026-09-13T18:00:00.000Z",
    };

    render(<InsightsScreen />);

    expect(screen.getAllByRole("button", { name: /generate/i })).toHaveLength(
      1,
    );
    expect(screen.getByText("2 of 2 left today")).toBeInTheDocument();
  });

  it("shows no allowance at all rather than '0 of 0' when it is unknown", () => {
    // `GET /digests/quota` 403s for a stale session and 404s against an older
    // API build. "0 of 0 left today" is indistinguishable from a spent
    // allowance and would stop an owner who has runs in hand.
    profile = {
      isLoading: false,
      data: { ai: { enabled: true, language: "en", hourLocal: 21 } },
    };
    quota = null;

    render(<InsightsScreen />);

    expect(screen.queryByText(/left today/)).toBeNull();
  });
});

describe("InsightsScreen — the period control", () => {
  it("offers the digest vocabulary, which is NOT the reports one", () => {
    // `today | last7 | last30 | last90 | year | custom`. The reports endpoints
    // take `today | week | month | year`, and the two disagree about what they
    // mean: "last 7 days" is a rolling window ending today where "week" is the
    // calendar week from Monday. Reusing the reports control here would
    // silently relabel one as the other.
    profile = {
      isLoading: false,
      data: { ai: { enabled: true, language: "en", hourLocal: 21 } },
    };

    render(<InsightsScreen />);

    const group = screen.getByRole("group", {
      name: /period for the next digest/i,
    });
    expect(group).toBeInTheDocument();
    for (const label of [
      "Today",
      "Last 7 days",
      "Last 30 days",
      "Last 90 days",
      "This year",
      "Custom",
    ]) {
      expect(screen.getByRole("radio", { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole("radio", { name: "This week" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "This month" })).toBeNull();
  });

  it("is not offered at all to a viewer who cannot spend a run", () => {
    // A control whose only purpose is to parameterise an action this viewer
    // may never take is noise. The allowance line still shows, because reading
    // it is `reports:view`.
    canRun = false;
    profile = {
      isLoading: false,
      data: { ai: { enabled: true, language: "en", hourLocal: 21 } },
    };

    render(<InsightsScreen />);

    expect(
      screen.queryByRole("group", { name: /period for the next digest/i }),
    ).toBeNull();
  });
});
