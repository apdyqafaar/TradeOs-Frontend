import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Announcement } from "../types";
import { AnnouncementCard, excerptOf } from "./announcement-card";

const row = (overrides: Partial<Announcement> = {}): Announcement => ({
  id: "68b0000000000000000000a1",
  title: "Stock take this Saturday",
  body: "We close the counter at 15:00 on Saturday for the monthly stock take.",
  pinned: false,
  cover: null,
  createdBy: "68b0000000000000000000b1",
  author: { id: "68b0000000000000000000b1", name: "Amina Mohamed" },
  createdAt: "2026-09-08T09:00:00.000Z",
  updatedAt: "2026-09-08T09:00:00.000Z",
  ...overrides,
});

describe("excerptOf", () => {
  it("leaves a short body alone", () => {
    expect(excerptOf("Short notice.")).toBe("Short notice.");
  });

  it("collapses newlines so a body starting with a blank line still shows", () => {
    // A card is two lines tall. Without this, a notice whose first character is
    // a newline renders an excerpt that looks empty.
    expect(excerptOf("\n\nWe close early.\n\nBring the scanner.")).toBe(
      "We close early. Bring the scanner.",
    );
  });

  it("cuts at a word boundary, never mid-word", () => {
    const body = "alpha bravo charlie delta echo";
    const cut = excerptOf(body, 14);
    expect(cut).toBe("alpha bravo…");
    expect(cut).not.toContain("charl");
  });

  it("still cuts when there is no space to cut at", () => {
    const body = "a".repeat(50);
    expect(excerptOf(body, 10)).toBe(`${"a".repeat(10)}…`);
  });
});

describe("AnnouncementCard", () => {
  it("names the author without a second request, because the API populates it", () => {
    // The one shape in this pair of features that comes back populated
    // (contract §2.4). A card written against the project shape would render
    // `undefined` here.
    render(<AnnouncementCard announcement={row()} timezone="Africa/Nairobi" />);
    expect(screen.getByText("Amina Mohamed")).toBeInTheDocument();
  });

  it("links the title to the reading screen", () => {
    render(<AnnouncementCard announcement={row()} timezone="Africa/Nairobi" />);
    expect(
      screen.getByRole("link", { name: "Stock take this Saturday" }),
    ).toHaveAttribute("href", "/announcements/68b0000000000000000000a1");
  });

  it("gives the pin an accessible name — pinned is state, not decoration", () => {
    render(
      <AnnouncementCard announcement={row({ pinned: true })} timezone="UTC" />,
    );
    expect(screen.getByLabelText("Pinned")).toBeInTheDocument();
  });

  it("shows no pin when the notice is not pinned", () => {
    render(<AnnouncementCard announcement={row()} timezone="UTC" />);
    expect(screen.queryByLabelText("Pinned")).not.toBeInTheDocument();
  });

  it("renders the cover thumbnail, decoratively — the title is the label", () => {
    const { container } = render(
      <AnnouncementCard
        announcement={row({
          cover: {
            uploadId: "68b0000000000000000000c1",
            url: "https://cdn/x.webp",
            thumbUrl: "https://cdn/x-thumb.webp",
          },
        })}
        timezone="UTC"
      />,
    );

    const img = container.querySelector("img");
    // `thumbUrl` on a card: `url` is the 1600px original and belongs to the
    // reading screen.
    expect(img).toHaveAttribute("src", "https://cdn/x-thumb.webp");
    expect(img).toHaveAttribute("alt", "");
  });

  it("stamps the machine-readable instant alongside the relative one", () => {
    const { container } = render(
      <AnnouncementCard announcement={row()} timezone="Africa/Nairobi" />,
    );
    expect(container.querySelector("time")).toHaveAttribute(
      "dateTime",
      "2026-09-08T09:00:00.000Z",
    );
  });
});
