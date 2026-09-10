import { describe, expect, it } from "vitest";
import type { Project } from "../types";
import {
  createProjectSchema,
  createProjectUpdateSchema,
  dateInputToIso,
  isoToDateInput,
  projectPatch,
  updateProjectSchema,
} from "./project.schema";

const project = (overrides: Partial<Project> = {}): Project => ({
  id: "68b0000000000000000000a1",
  title: "Shopfront refit",
  description: "New counter and shelving.",
  customerId: null,
  status: "in_progress",
  progress: 40,
  startDate: null,
  dueDate: null,
  isPublished: false,
  publishedAt: null,
  cover: null,
  createdBy: "68b0000000000000000000b1",
  createdAt: "2026-08-01T09:00:00.000Z",
  updatedAt: "2026-08-01T09:00:00.000Z",
  ...overrides,
});

/**
 * The form values a screen holds. Defaults mirror an unedited form opened over
 * `project()` above, so each test changes exactly the one field it is about.
 */
const form = (overrides: Partial<Parameters<typeof projectPatch>[1]> = {}) => ({
  title: "Shopfront refit",
  description: "New counter and shelving.",
  customerId: "",
  status: "in_progress" as const,
  progress: 40,
  startDate: undefined,
  dueDate: undefined,
  coverUploadId: null,
  ...overrides,
});

describe("createProjectSchema", () => {
  it("defaults status and progress, so a title alone is a legal body", () => {
    const parsed = createProjectSchema.parse({ title: "T" });
    expect(parsed).toEqual({ title: "T", status: "planned", progress: 0 });
  });

  it("trims the title, then rejects one made only of spaces", () => {
    expect(createProjectSchema.parse({ title: "  Hi  " }).title).toBe("Hi");
    expect(createProjectSchema.safeParse({ title: "   " }).success).toBe(false);
  });

  it("rejects a fractional progress, because the API asks for an int", () => {
    const parsed = createProjectSchema.safeParse({
      title: "T",
      progress: 100.5,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a date that is not a full instant ending in Z", () => {
    // The three cases verified against the real backend schema in contract
    // §1.2. The offset form is the dangerous one — it is what a
    // timezone-aware date library hands you by default.
    for (const startDate of [
      "2026-01-01",
      "2026-01-01T00:00:00+02:00",
      "2026-01-01T00:00:00",
    ]) {
      expect(
        createProjectSchema.safeParse({ title: "T", startDate }).success,
      ).toBe(false);
    }
    expect(
      createProjectSchema.safeParse({
        title: "T",
        startDate: "2026-01-01T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });
});

describe("updateProjectSchema", () => {
  it("refuses an empty patch — the regression guard on the .partial() defect", () => {
    // If `status`/`progress` ever gain a `.default()` on the shared shape,
    // `{}` starts parsing clean and an untouched edit silently resets a project
    // to "planned" at 0%. That is the defect contract §1.3 verified is real in
    // this zod version.
    const parsed = updateProjectSchema.safeParse({});
    expect(parsed.success).toBe(false);
    expect(
      updateProjectSchema.safeParse({}).error?.issues[0]?.message,
    ).toContain("At least one field");
  });

  it("does not invent status or progress on a one-field patch", () => {
    const parsed = updateProjectSchema.parse({ title: "New" });
    expect(parsed).toEqual({ title: "New" });
  });
});

describe("createProjectUpdateSchema", () => {
  it("accepts a body alone and adds no default progress", () => {
    expect(createProjectUpdateSchema.parse({ body: "Framing done" })).toEqual({
      body: "Framing done",
    });
  });

  it("rejects progress: null — the key must be omitted instead", () => {
    expect(
      createProjectUpdateSchema.safeParse({ body: "x", progress: null })
        .success,
    ).toBe(false);
  });

  it("accepts progress: 0, which is a real value", () => {
    expect(
      createProjectUpdateSchema.parse({ body: "Reset", progress: 0 }).progress,
    ).toBe(0);
  });
});

describe("dateInputToIso", () => {
  it("ends in Z and never in an offset", () => {
    // TZDate.prototype.toISOString() emits the OFFSET form
    // (`@date-fns/tz/date/index.js:14-17`), which the backend rejects outright.
    // This is the assertion that keeps that mistake out.
    const iso = dateInputToIso("2026-01-01", "Africa/Nairobi");
    expect(iso).toMatch(/Z$/);
    expect(iso).not.toMatch(/[+-]\d{2}:\d{2}$/);
  });

  it("resolves the day in the business zone, not the runner's", () => {
    // Nairobi is UTC+3, so local midnight is 21:00 the previous day in UTC.
    expect(dateInputToIso("2026-01-01", "Africa/Nairobi")).toBe(
      "2025-12-31T21:00:00.000Z",
    );
    expect(dateInputToIso("2026-01-01", "UTC")).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("answers undefined for an empty or unparseable value", () => {
    // `undefined` is the caller's cue to omit the key — there is no `null` to
    // send, because `startDate: null` is a 422.
    expect(dateInputToIso("", "UTC")).toBeUndefined();
    expect(dateInputToIso("not a date", "UTC")).toBeUndefined();
  });

  it("round-trips through isoToDateInput in the same zone", () => {
    const iso = dateInputToIso("2026-03-18", "Africa/Nairobi");
    expect(isoToDateInput(iso ?? null, "Africa/Nairobi")).toBe("2026-03-18");
  });
});

describe("projectPatch", () => {
  it("answers null when nothing changed, so no empty PATCH is ever sent", () => {
    expect(projectPatch(project(), form())).toBeNull();
  });

  it("keeps progress: 0 — the reset a truthiness filter would drop", () => {
    expect(
      projectPatch(project({ progress: 40 }), form({ progress: 0 })),
    ).toEqual({ progress: 0 });
  });

  it("sends coverUploadId: null present-and-null when a cover is removed", () => {
    const withCover = project({
      cover: {
        uploadId: "68b0000000000000000000c1",
        url: "https://x/a.webp",
        thumbUrl: "https://x/a-t.webp",
      },
    });
    const patch = projectPatch(withCover, form({ coverUploadId: null }));
    expect(patch).toEqual({ coverUploadId: null });
    // Present, not merely falsy: dropping the key means "keep it".
    expect(Object.hasOwn(patch ?? {}, "coverUploadId")).toBe(true);
  });

  it("never sends null for the four fields that cannot be cleared", () => {
    const full = project({
      description: "Something",
      customerId: "68b0000000000000000000d1",
      startDate: "2026-01-01T00:00:00.000Z",
      dueDate: "2026-03-01T00:00:00.000Z",
    });
    // The form has been emptied of all four. `description` can go to `""`;
    // the other three are one-way doors, so they are simply omitted.
    const patch = projectPatch(
      full,
      form({
        description: "",
        customerId: "",
        startDate: undefined,
        dueDate: undefined,
      }),
    );
    expect(patch).toEqual({ description: "" });
    expect(Object.values(patch ?? {})).not.toContain(null);
  });

  it('treats a description of null and one of "" as the same absence', () => {
    // The wire can answer either for "there isn't one" (contract §1.3), and a
    // form holding "" must not read as a change against a stored `null`.
    expect(
      projectPatch(project({ description: null }), form({ description: "" })),
    ).toBeNull();
  });

  it("compares dates as instants, not as strings", () => {
    const stored = project({ startDate: "2026-01-01T00:00:00Z" });
    const patch = projectPatch(
      stored,
      form({ startDate: "2026-01-01T00:00:00.000Z" }),
    );
    expect(patch).toBeNull();
  });

  it("trims before comparing, so a trailing space is not a change", () => {
    expect(
      projectPatch(project({ title: "Refit" }), form({ title: "Refit " })),
    ).toBeNull();
  });
});
