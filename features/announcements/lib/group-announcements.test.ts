import { describe, expect, it } from "vitest";
import type { Announcement } from "../types";
import { groupAnnouncements, isUnread } from "./group-announcements";

const row = (overrides: Partial<Announcement> = {}): Announcement => ({
  id: "68b0000000000000000000a1",
  title: "Stock take this Saturday",
  body: "We close the counter at 15:00.",
  pinned: false,
  cover: null,
  createdBy: "68b0000000000000000000b1",
  author: { id: "68b0000000000000000000b1", name: "Amina Mohamed" },
  createdAt: "2026-09-08T09:00:00.000Z",
  updatedAt: "2026-09-08T09:00:00.000Z",
  ...overrides,
});

/** The labels, in the order they came back. */
const labels = (
  items: Announcement[],
  timezone: string,
  now: string,
): string[] => groupAnnouncements(items, timezone, now).map((g) => g.label);

/** Which group one row landed in. */
const groupOf = (
  announcement: Announcement,
  timezone: string,
  now: string,
): string => {
  const groups = groupAnnouncements([announcement], timezone, now);
  expect(groups).toHaveLength(1);
  return groups[0].label;
};

describe("isUnread", () => {
  it("is true only for an explicit null — the API saying 'tracked, not read'", () => {
    expect(isUnread(row({ readAt: null }))).toBe(true);
  });

  it("is false once the row carries a timestamp", () => {
    expect(isUnread(row({ readAt: "2026-09-08T10:00:00.000Z" }))).toBe(false);
  });

  it("is false when the API sends no readAt at all", () => {
    // The whole reason `readAt` is optional. Read tracking is three aggregate
    // endpoints — a count, a receipt, a bulk mark — and none of them says which
    // rows in a page are unread. `!readAt` here would paint a dot on every row
    // in the feed the moment the field is missing, which reads as "this product
    // thinks I have read nothing".
    expect(isUnread(row())).toBe(false);
    expect(row().readAt).toBeUndefined();
  });
});

describe("groupAnnouncements", () => {
  const now = "2026-09-10T09:00:00.000Z";

  it("returns nothing for an empty feed", () => {
    expect(groupAnnouncements([], "Africa/Nairobi", now)).toEqual([]);
  });

  it("puts every pinned notice in one group above everything, whatever its age", () => {
    // The server sorts `{ pinned: -1, createdAt: -1 }` *before* it paginates
    // and there is no cap on how many may be pinned, so a six-month-old pinned
    // notice legitimately heads page 1. Bucketing it by date would move a row
    // the server deliberately put at the top.
    const groups = groupAnnouncements(
      [
        row({ id: "old-pin", pinned: true, createdAt: "2026-03-01T09:00:00Z" }),
        row({ id: "new-pin", pinned: true, createdAt: "2026-09-10T08:00:00Z" }),
        row({ id: "today", createdAt: "2026-09-10T05:00:00Z" }),
      ],
      "Africa/Nairobi",
      now,
    );

    expect(groups.map((g) => g.key)).toEqual(["pinned", "today"]);
    expect(groups[0].items.map((a) => a.id)).toEqual(["old-pin", "new-pin"]);
  });

  it("keeps the server's order inside a group", () => {
    // The client cannot ask for another ordering — the query schema is
    // `page` and `limit` and nothing else — so nothing here may sort.
    const groups = groupAnnouncements(
      [
        row({ id: "c", createdAt: "2026-09-10T02:00:00Z" }),
        row({ id: "a", createdAt: "2026-09-10T07:00:00Z" }),
        row({ id: "b", createdAt: "2026-09-10T05:00:00Z" }),
      ],
      "Africa/Nairobi",
      now,
    );

    expect(groups[0].items.map((a) => a.id)).toEqual(["c", "a", "b"]);
  });

  it("emits the four time groups in a fixed order and drops the empty ones", () => {
    expect(
      labels(
        [
          row({ id: "d", createdAt: "2026-08-01T05:00:00Z" }),
          row({ id: "a", createdAt: "2026-09-10T05:00:00Z" }),
          row({ id: "c", createdAt: "2026-09-07T05:00:00Z" }),
        ],
        "Africa/Nairobi",
        now,
      ),
    ).toEqual(["Today", "Earlier this week", "Earlier"]);
  });

  it("groups by the business's calendar day, not the browser's", () => {
    // 22:00 UTC on the 9th is 01:00 on the **10th** in Nairobi (UTC+3), so to
    // the shop this notice went up today. Reading the browser's zone here would
    // file it under "Yesterday" for a reader in London and "Today" for one in
    // Nairobi, looking at the same feed.
    const late = row({ createdAt: "2026-09-09T22:00:00.000Z" });
    expect(groupOf(late, "Africa/Nairobi", now)).toBe("Today");
    expect(groupOf(late, "UTC", now)).toBe("Yesterday");
  });

  it("counts calendar days, not elapsed hours, across a daylight-saving change", () => {
    // Sydney springs forward on 2026-10-04: 02:00 becomes 03:00, so that day
    // is 23 hours long. The notice went up at 23:30 on the 3rd local
    // (12:30 UTC, AEST +10) and it is now 22:00 on the 4th local (11:00 UTC,
    // AEDT +11) — **22 and a half hours later**, which any "hours ÷ 24" rule
    // reports as zero days and files under "Today". It was yesterday.
    expect(
      groupOf(
        row({ createdAt: "2026-10-03T12:30:00.000Z" }),
        "Australia/Sydney",
        "2026-10-04T11:00:00.000Z",
      ),
    ).toBe("Yesterday");
  });

  it("still says Yesterday one minute after midnight", () => {
    // 23:50 last night is not "10 minutes ago, Today". The heading and
    // `formatRelative`'s "1 d ago" have to agree, and both are calendar days.
    expect(
      groupOf(
        row({ createdAt: "2026-09-09T20:50:00.000Z" }), // 23:50 in Nairobi
        "Africa/Nairobi",
        "2026-09-09T21:10:00.000Z", // 00:10 the next day in Nairobi
      ),
    ).toBe("Yesterday");
  });

  it("holds the six-day boundary inside the week and the seventh outside it", () => {
    // Seven days is where `formatRelative` stops saying "6 d ago" and starts
    // printing an absolute date, so the heading changes on exactly the row the
    // timestamps do.
    expect(
      groupOf(row({ createdAt: "2026-09-04T09:00:00Z" }), "UTC", now),
    ).toBe("Earlier this week");
    expect(
      groupOf(row({ createdAt: "2026-09-03T09:00:00Z" }), "UTC", now),
    ).toBe("Earlier");
  });

  it("files a notice stamped in the future under Today rather than losing it", () => {
    // The server stamps `createdAt` and the browser supplies `now`; a clock a
    // few seconds apart is normal. A rule written as `days === 0` rather than
    // `days <= 0` drops the row out of every bucket, and it vanishes from a
    // feed that still says "21 notices".
    expect(
      groupOf(row({ createdAt: "2026-09-10T09:00:30Z" }), "UTC", now),
    ).toBe("Today");
  });

  it("loses no row, whatever the mix", () => {
    const items = [
      row({ id: "1", pinned: true }),
      row({ id: "2", createdAt: "2026-09-10T05:00:00Z" }),
      row({ id: "3", createdAt: "2026-09-09T05:00:00Z" }),
      row({ id: "4", createdAt: "2026-09-06T05:00:00Z" }),
      row({ id: "5", createdAt: "2025-01-01T05:00:00Z" }),
      row({ id: "6", createdAt: "not a date" }),
    ];

    const grouped = groupAnnouncements(items, "Africa/Nairobi", now);
    expect(grouped.flatMap((g) => g.items.map((a) => a.id))).toHaveLength(
      items.length,
    );
  });

  it("does not drop a row whose createdAt is unparseable", () => {
    // Never seen on the wire, but a row that renders nowhere is worse than a
    // row in the wrong group: the feed would silently be shorter than its own
    // count.
    expect(groupOf(row({ createdAt: "not a date" }), "UTC", now)).toBe(
      "Earlier",
    );
  });
});
