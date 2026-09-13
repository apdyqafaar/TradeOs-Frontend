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

vi.mock("@/features/insights/hooks/use-digests", () => ({
  useLatestDigest: () => latest,
  useDigests: () => ({
    data: undefined,
    error: null,
    isPending: false,
    refetch: vi.fn(),
  }),
  useRunDigest: () => ({ mutate: vi.fn(), isPending: false, error: null }),
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
});

describe("InsightsScreen — off, on-but-waiting, and present", () => {
  it("says the digest is off, promises no arrival time, and offers no Generate when ai.enabled is false", () => {
    profile = {
      isLoading: false,
      data: { ai: { enabled: false, language: "en", hourLocal: 21 } },
    };

    render(<InsightsScreen />);

    expect(screen.getByText(/daily digest is off/i)).toBeInTheDocument();
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

    expect(screen.getByText(/daily digest is off/i)).toBeInTheDocument();
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

    expect(screen.getByText(/20:00 tonight/)).toBeInTheDocument();
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

    expect(screen.getByText("A steady Saturday")).toBeInTheDocument();
    expect(screen.queryByText(/no digest yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/daily digest is off/i)).not.toBeInTheDocument();
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
