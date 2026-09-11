import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnnouncementsUnreadBadge } from "./announcements-unread-badge";

const unreadQuery = vi.fn();
vi.mock("../hooks/use-announcement-unread", () => ({
  useUnreadAnnouncementCount: () => unreadQuery(),
}));

beforeEach(() => {
  unreadQuery.mockReset();
});

describe("AnnouncementsUnreadBadge", () => {
  it("renders nothing at all while the count is loading", () => {
    // Not an empty pill and not a placeholder. This component sits in the
    // chrome of every screen in the product; a badge that appears empty and
    // then fills in is a layout shift for the whole session.
    unreadQuery.mockReturnValue({ data: undefined });
    const { container } = render(<AnnouncementsUnreadBadge />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing at all at zero — not a 0", () => {
    unreadQuery.mockReturnValue({ data: 0 });
    const { container } = render(<AnnouncementsUnreadBadge />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the count failed to load", () => {
    // A failure must not put an error into the sidebar of every screen.
    unreadQuery.mockReturnValue({ data: undefined, isError: true });
    const { container } = render(<AnnouncementsUnreadBadge />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the number", () => {
    unreadQuery.mockReturnValue({ data: 3 });
    render(<AnnouncementsUnreadBadge />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("caps the visible pill at 9+ but tells assistive tech the real number", () => {
    // The cap is about pixels in a 240px sidebar. That reason does not apply to
    // a screen reader, and "12 unread" is a better sentence than "9+ unread".
    unreadQuery.mockReturnValue({ data: 12 });
    render(<AnnouncementsUnreadBadge />);

    expect(screen.getByText("9+")).toBeInTheDocument();
    expect(screen.getByText(", 12 unread")).toBeInTheDocument();
  });

  it("does not cap at exactly nine", () => {
    unreadQuery.mockReturnValue({ data: 9 });
    render(<AnnouncementsUnreadBadge />);
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.queryByText("9+")).not.toBeInTheDocument();
  });

  it("hides the visible number from assistive tech so it is not read twice", () => {
    unreadQuery.mockReturnValue({ data: 3 });
    render(<AnnouncementsUnreadBadge />);
    expect(screen.getByText("3")).toHaveAttribute("aria-hidden", "true");
  });

  it("gives the collapsed rail a dot and no pill, keeping the spoken count", () => {
    // There is no room for a pill beside a 40px centred icon, and the label it
    // would sit against is `sr-only` there.
    unreadQuery.mockReturnValue({ data: 4 });
    render(<AnnouncementsUnreadBadge collapsed />);

    expect(screen.queryByText("4")).not.toBeInTheDocument();
    expect(screen.getByText(", 4 unread")).toBeInTheDocument();
  });
});
