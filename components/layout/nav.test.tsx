import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NAV_GROUPS } from "@/config/routes";
import { NavGroups } from "./nav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/overview",
}));

vi.mock("@/features/auth/hooks/use-session", () => ({
  useSession: () => ({ isPending: false }),
}));

const can = vi.fn(() => true);
vi.mock("@/features/auth/hooks/use-permission", () => ({
  useCan: () => can(),
}));

/**
 * The badge's own query is stubbed, not the badge. The point of this file is
 * the wiring — that exactly one nav item mounts a counter, that it lands inside
 * the anchor, and that the eleven others are untouched — so the real component
 * has to render.
 */
const unreadQuery = vi.fn();
vi.mock("@/features/announcements/hooks/use-announcement-unread", () => ({
  useUnreadAnnouncementCount: () => unreadQuery(),
}));

beforeEach(() => {
  can.mockReturnValue(true);
  unreadQuery.mockReset();
  unreadQuery.mockReturnValue({ data: 0 });
});

describe("nav badges", () => {
  it("declares a badge on exactly one item, and it is Announcements", () => {
    // The token lives in `config/routes.ts` so that file stays data-only — a
    // `"use client"` component in it would drag React Query into every Server
    // Component that imports a route.
    const badged = NAV_GROUPS.flatMap((group) =>
      group.items.filter((item) => item.badge),
    );

    expect(badged).toHaveLength(1);
    expect(badged[0].href).toBe("/announcements");
    expect(badged[0].badge).toBe("announcements-unread");
  });

  it("asks for the count once, however many nav items there are", () => {
    // The whole reason for the registry: one `<li>` subscribes, the rest render
    // as they always did.
    render(<NavGroups />);
    expect(unreadQuery).toHaveBeenCalledTimes(1);
  });

  it("folds the count into the link's accessible name", () => {
    // "Announcements, 3 unread" as one phrase — not "Announcements" with a
    // stray 3 beside it, which is announced as a count of nothing in
    // particular.
    //
    // The regex is not slack: accname concatenates each child element's text
    // **space-separated**, so the computed name is literally
    // `"Announcements , 3 unread"` — in a browser as well as here. A space
    // before a comma is not spoken, so what a reader hears is the phrase
    // above; asserting the exact string would be enshrining the algorithm's
    // separator rather than the requirement.
    unreadQuery.mockReturnValue({ data: 3 });
    render(<NavGroups />);

    expect(
      screen.getByRole("link", { name: /^Announcements\s*,\s*3 unread$/ }),
    ).toHaveAttribute("href", "/announcements");
  });

  it("leaves the link's name alone when nothing is unread", () => {
    unreadQuery.mockReturnValue({ data: 0 });
    render(<NavGroups />);

    expect(
      screen.getByRole("link", { name: "Announcements" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("puts no badge on any other item", () => {
    unreadQuery.mockReturnValue({ data: 3 });
    render(<NavGroups />);

    expect(screen.getByRole("link", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Projects" })).toBeInTheDocument();
  });

  it("keeps the collapsed rail's name spoken and its label hidden", () => {
    // The rail's label is `sr-only`, so the dot has nowhere to sit visually —
    // but the name a screen reader hears must still carry the count.
    unreadQuery.mockReturnValue({ data: 2 });
    render(<NavGroups variant="rail" />);

    expect(
      screen.getByRole("link", { name: /^Announcements\s*,\s*2 unread$/ }),
    ).toBeInTheDocument();
  });

  it("keeps `relative` on the link, which is what the rail's dot is positioned against", () => {
    unreadQuery.mockReturnValue({ data: 2 });
    render(<NavGroups variant="rail" />);

    expect(
      screen.getByRole("link", { name: /^Announcements\s*,\s*2 unread$/ }),
    ).toHaveClass("relative");
  });
});
