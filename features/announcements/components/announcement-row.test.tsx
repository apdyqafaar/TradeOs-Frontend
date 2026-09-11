import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Announcement } from "../types";
import { AnnouncementRow, excerptOf } from "./announcement-row";

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

/** The feed rows are `<li>`s, so a bare render needs a list around them. */
const renderRow = (announcement: Announcement, timezone = "Africa/Nairobi") =>
  render(
    <ul>
      <AnnouncementRow announcement={announcement} timezone={timezone} />
    </ul>,
  );

describe("excerptOf", () => {
  it("leaves a short body alone", () => {
    expect(excerptOf("Short notice.")).toBe("Short notice.");
  });

  it("collapses newlines so a body starting with a blank line still shows", () => {
    // A row is two lines tall. Without this, a notice whose first character is
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

describe("AnnouncementRow", () => {
  it("names the author without a second request, because the API populates it", () => {
    // The one shape in this pair of features that comes back populated
    // (contract §2.4). A row written against the project shape would render
    // `undefined` here.
    renderRow(row());
    expect(screen.getByText("Amina Mohamed")).toBeInTheDocument();
  });

  it("falls back when the populate failed entirely and the name is an empty string", () => {
    // `author` is `{ id: "", name: "" }` when `createdBy` does not populate —
    // an empty string, never null, so `??` never fires.
    renderRow(row({ author: { id: "", name: "" } }));
    expect(screen.getByText("Unknown member")).toBeInTheDocument();
  });

  it("links the title to the reading screen", () => {
    renderRow(row());
    expect(
      screen.getByRole("link", { name: "Stock take this Saturday" }),
    ).toHaveAttribute("href", "/announcements/68b0000000000000000000a1");
  });

  it("gives the pin an accessible name — pinned is state, not decoration", () => {
    renderRow(row({ pinned: true }), "UTC");
    expect(screen.getByLabelText("Pinned")).toBeInTheDocument();
  });

  it("shows no pin when the notice is not pinned", () => {
    renderRow(row(), "UTC");
    expect(screen.queryByLabelText("Pinned")).not.toBeInTheDocument();
  });

  it("renders the cover thumbnail, decoratively — the title is the label", () => {
    const { container } = renderRow(
      row({
        cover: {
          uploadId: "68b0000000000000000000c1",
          url: "https://cdn/x.webp",
          thumbUrl: "https://cdn/x-thumb.webp",
        },
      }),
      "UTC",
    );

    const img = container.querySelector("img");
    // `thumbUrl` on a row: `url` is the 1600px original and belongs to the
    // reading screen.
    expect(img).toHaveAttribute("src", "https://cdn/x-thumb.webp");
    expect(img).toHaveAttribute("alt", "");
  });

  it("lets a tap on the thumbnail reach the link under it", () => {
    // The image is painted after the title link's stretched `::after`, so
    // without `pointer-events-none` the largest tap target in the row would be
    // the one part of it that is not a link — on phones, which is this
    // product's main platform.
    const { container } = renderRow(
      row({
        cover: {
          uploadId: "68b0000000000000000000c1",
          url: "https://cdn/x.webp",
          thumbUrl: "https://cdn/x-thumb.webp",
        },
      }),
      "UTC",
    );

    expect(container.querySelector("img")).toHaveClass("pointer-events-none");
  });

  it("stamps the machine-readable instant alongside the relative one", () => {
    const { container } = renderRow(row());
    expect(container.querySelector("time")).toHaveAttribute(
      "dateTime",
      "2026-09-08T09:00:00.000Z",
    );
  });

  it("marks an unread notice for a reader who cannot see the dot", () => {
    // `readAt: null` is the API saying "tracked, and you have not read it".
    renderRow(row({ readAt: null }), "UTC");
    expect(screen.getByText(/unread/)).toBeInTheDocument();
  });

  it("says nothing about read state when the row has been read", () => {
    renderRow(row({ readAt: "2026-09-08T10:00:00.000Z" }), "UTC");
    expect(screen.queryByText(/unread/)).not.toBeInTheDocument();
  });

  it("says nothing about read state when the API does not send readAt at all", () => {
    // The field is optional because read tracking arrived as three aggregate
    // endpoints and no per-row field. A row with no `readAt` must not be
    // painted unread — that would mark the entire feed unread forever.
    renderRow(row(), "UTC");
    expect(screen.queryByText(/unread/)).not.toBeInTheDocument();
  });
});
