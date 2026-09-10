import { describe, expect, it } from "vitest";
import type { Announcement } from "../types";
import {
  announcementPatch,
  createAnnouncementSchema,
  FORM_LEVEL_ERROR_KEY,
  updateAnnouncementSchema,
} from "./announcement.schema";

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

describe("createAnnouncementSchema", () => {
  it("fills pinned with false, the feature's only default", () => {
    // Mirrors the contract's own verification of the real backend schema
    // (§2.2): `parse({title:"T", body:"B"})` -> `{title, body, pinned:false}`.
    expect(createAnnouncementSchema.parse({ title: "T", body: "B" })).toEqual({
      title: "T",
      body: "B",
      pinned: false,
    });
  });

  it("trims before checking the minimum, so a title of spaces is refused", () => {
    expect(
      createAnnouncementSchema.parse({ title: "  Hi  ", body: "B" }).title,
    ).toBe("Hi");
    expect(
      createAnnouncementSchema.safeParse({ title: "   ", body: "B" }).success,
    ).toBe(false);
  });

  it("refuses an empty body — unlike a project description, which may be blank", () => {
    // `body` carries `.min(1)`; `project.description` does not. Getting this
    // backwards is the difference between a 422 and a blank notice.
    expect(
      createAnnouncementSchema.safeParse({ title: "T", body: "" }).success,
    ).toBe(false);
  });

  it("rejects an unknown key rather than dropping it, because the API is .strict()", () => {
    const result = createAnnouncementSchema.safeParse({
      title: "T",
      body: "B",
      // The field a UI might invent. There is no publish state at all.
      published: true,
    });
    expect(result.success).toBe(false);
  });

  it("takes a cover id, and takes null on create without complaining", () => {
    // `null` is accepted and silently ignored by the create service, which
    // guards with `if (input.coverUploadId)`. It must not be a parse failure.
    expect(
      createAnnouncementSchema.safeParse({
        title: "T",
        body: "B",
        coverUploadId: null,
      }).success,
    ).toBe(true);
    expect(
      createAnnouncementSchema.safeParse({
        title: "T",
        body: "B",
        coverUploadId: "not-an-id",
      }).success,
    ).toBe(false);
  });
});

describe("updateAnnouncementSchema", () => {
  it("refuses an empty patch, the way the API does", () => {
    // The live guard on the backend is `announcements.test.ts:209-222`. This is
    // the same refusal, one round trip earlier.
    const result = updateAnnouncementSchema.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "At least one field must be provided",
    );
  });

  it('reports the empty-patch refusal with an empty path — which the API keys as "_"', () => {
    const result = updateAnnouncementSchema.safeParse({});
    // An object-level issue has an empty path, and `zodToFieldErrors` names an
    // empty path `"_"`. A form that only reads named fields drops this message.
    expect(result.error?.issues[0]?.path).toEqual([]);
    expect(FORM_LEVEL_ERROR_KEY).toBe("_");
  });

  it("does NOT resurrect the pinned default on a partial parse", () => {
    // The defect the contract verified is still real in this zod version:
    // `.partial()` does not suppress a `.default()`. This asserts the mirror is
    // arranged the way the backend's is — the default lives on the create
    // schema, never on the shared shape — so a one-field patch cannot carry a
    // silent `pinned: false` that unpins the notice.
    const result = updateAnnouncementSchema.parse({ title: "New" });
    expect(result).toEqual({ title: "New" });
    expect("pinned" in result).toBe(false);
  });

  it("accepts pinned:false alone — false is a value, not an absence", () => {
    expect(updateAnnouncementSchema.safeParse({ pinned: false }).success).toBe(
      true,
    );
  });

  it("accepts coverUploadId:null alone — the instruction to delete the image", () => {
    expect(
      updateAnnouncementSchema.safeParse({ coverUploadId: null }).success,
    ).toBe(true);
  });
});

describe("announcementPatch", () => {
  const next = (
    overrides: Partial<Parameters<typeof announcementPatch>[1]> = {},
  ) => ({
    title: "Stock take this Saturday",
    body: "We close the counter at 15:00.",
    pinned: false,
    coverUploadId: null,
    ...overrides,
  });

  it("returns null when nothing changed, so an empty PATCH is never sent", () => {
    // The whole reason this function exists. `PATCH {}` is a 422 whose message
    // lands under `"_"` — a mystery error on a form the user believes they left
    // alone.
    expect(announcementPatch(row(), next())).toBeNull();
  });

  it("sends only the field that moved", () => {
    expect(
      announcementPatch(row(), next({ title: "Stock take Sunday" })),
    ).toEqual({ title: "Stock take Sunday" });
  });

  it("sends pinned:false when unpinning — the value a truthiness filter drops", () => {
    // The failure this test exists for: `if (next.pinned)` would produce `{}`
    // here, which is a 422, and the Unpin button would never work.
    expect(
      announcementPatch(row({ pinned: true }), next({ pinned: false })),
    ).toEqual({ pinned: false });
  });

  it("sends pinned:true when pinning", () => {
    expect(announcementPatch(row(), next({ pinned: true }))).toEqual({
      pinned: true,
    });
  });

  it("sends coverUploadId:null when a cover is cleared, key present", () => {
    const withCover = row({
      cover: {
        uploadId: "68b0000000000000000000c1",
        url: "https://cdn/x.webp",
        thumbUrl: "https://cdn/x-t.webp",
      },
    });
    const patch = announcementPatch(withCover, next());
    // Present AND null. A dropped key means "leave the cover alone" and the
    // image would stay.
    expect(patch).toEqual({ coverUploadId: null });
    expect(patch && "coverUploadId" in patch).toBe(true);
  });

  it("sends the new cover id when one replaces another", () => {
    const withCover = row({
      cover: {
        uploadId: "68b0000000000000000000c1",
        url: "https://cdn/x.webp",
        thumbUrl: "https://cdn/x-t.webp",
      },
    });
    expect(
      announcementPatch(
        withCover,
        next({ coverUploadId: "68b0000000000000000000c2" }),
      ),
    ).toEqual({ coverUploadId: "68b0000000000000000000c2" });
  });

  it("does not resend a cover that did not change", () => {
    const cover = {
      uploadId: "68b0000000000000000000c1",
      url: "https://cdn/x.webp",
      thumbUrl: "https://cdn/x-t.webp",
    };
    expect(
      announcementPatch(
        row({ cover }),
        next({ coverUploadId: cover.uploadId, title: "New title" }),
      ),
    ).toEqual({ title: "New title" });
  });

  it("treats a title that only gained whitespace as unchanged", () => {
    // The API trims, so an untrimmed comparison would post a value identical to
    // the stored one and call it an edit.
    expect(
      announcementPatch(row(), next({ title: "  Stock take this Saturday  " })),
    ).toBeNull();
  });

  it("sends every field that moved at once", () => {
    expect(
      announcementPatch(
        row({ pinned: true }),
        next({ title: "T2", body: "B2", pinned: false }),
      ),
    ).toEqual({ title: "T2", body: "B2", pinned: false });
  });
});
