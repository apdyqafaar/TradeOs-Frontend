import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceSession } from "@/features/auth/services/auth.service";
import { SessionsPanel } from "./sessions-panel";

const sessions = vi.fn();
const logoutOthers = vi.fn();
const logoutEverywhere = vi.fn();

vi.mock("@/features/account/hooks/use-device-sessions", () => ({
  useDeviceSessions: () => sessions(),
  useLogoutOthers: () => ({
    mutate: logoutOthers,
    isPending: false,
    error: null,
  }),
  useLogoutEverywhere: () => ({ mutate: logoutEverywhere, isPending: false }),
}));

vi.mock("@/features/organization/hooks/use-organization", () => ({
  useOrganization: () => ({
    timezone: "Africa/Nairobi",
    currency: "KES",
    isLoading: false,
  }),
}));

const ROWS: DeviceSession[] = [
  {
    id: "s1",
    ipAddress: "41.90.64.12",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    createdAt: "2026-09-07T05:02:00.000Z",
    expiresAt: "2026-10-07T05:02:00.000Z",
    isCurrent: true,
  },
  {
    id: "s2",
    ipAddress: null,
    userAgent: null,
    createdAt: "2026-09-05T04:44:00.000Z",
    expiresAt: "2026-10-05T04:44:00.000Z",
    isCurrent: false,
  },
];

const ready = (rows: DeviceSession[] = ROWS) =>
  sessions.mockReturnValue({
    data: rows,
    isPending: false,
    error: null,
    refetch: vi.fn(),
  });

beforeEach(() => {
  sessions.mockReset();
  logoutOthers.mockReset();
  logoutEverywhere.mockReset();
});

/**
 * The single most important assertion in this slice's UI: **there is no
 * per-session revoke endpoint**, so there must be no per-row control.
 *
 * The design canvas draws one. The API has four session routes in total —
 * `GET /auth/sessions`, `/logout`, `/logout-all`, `/logout-others` — and
 * `session.actions.ts` exports nothing reachable with a client-supplied id
 * (`docs/contracts/settings-account.md` §6). Wiring a row button to
 * `logout-others` would sign out three devices when one was asked for; drawing
 * one disabled would advertise a control that is not coming.
 */
describe("SessionsPanel", () => {
  it("renders no per-row sign-out control", () => {
    ready();
    render(<SessionsPanel />);

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(within(row).queryByRole("button")).toBeNull();
    }
  });

  it("says plainly that signing out one device is not possible", () => {
    ready();
    render(<SessionsPanel />);

    expect(
      screen.getByText(/signing out a single device is not possible yet/i),
    ).toBeInTheDocument();
  });

  it("offers exactly the two account-wide actions the API has", () => {
    ready();
    render(<SessionsPanel />);

    expect(
      screen.getByRole("button", { name: /sign out other devices/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign out everywhere/i }),
    ).toBeInTheDocument();
  });

  it("warns that signing out everywhere ends this session too, before doing it", async () => {
    // `/logout-all` clears the caller's own cookie; `/logout-others`
    // deliberately does not. Confusing them costs somebody their place.
    const user = userEvent.setup();
    ready();
    render(<SessionsPanel />);

    await user.click(
      screen.getByRole("button", { name: /sign out everywhere/i }),
    );

    expect(screen.getByText(/including this one/i)).toBeInTheDocument();
    // The first press only asks; nothing is revoked until the confirmation.
    expect(logoutEverywhere).not.toHaveBeenCalled();
  });

  it("labels the current device and reads the raw user agent", () => {
    ready();
    render(<SessionsPanel />);

    expect(screen.getByText("This device")).toBeInTheDocument();
    expect(screen.getByText("Chrome · Windows")).toBeInTheDocument();
  });

  it("survives a session with no user agent and no IP, both of which are nullable", () => {
    ready();
    render(<SessionsPanel />);
    expect(screen.getByText("Device not recorded")).toBeInTheDocument();
  });

  it("never labels a timestamp as activity", () => {
    // There is no "last active" field. `expiresAt` moves at most once a day
    // (`session.service.ts:68-75`), so rendering it as activity would say
    // "active 20 hours ago" about a tab closed a week ago.
    ready();
    render(<SessionsPanel />);

    expect(screen.queryByText(/last active/i)).toBeNull();
    expect(screen.getAllByText(/signed in .* · expires/i).length).toBe(2);
  });
});
