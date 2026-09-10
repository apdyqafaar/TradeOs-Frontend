import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { HELP_ARTICLES, HELP_SECTIONS } from "@/features/help/content";
import { HelpCenter, matchesQuery } from "./help-center";

const wrapper = ({ children }: { children: ReactNode }) => (
  <NuqsTestingAdapter>{children}</NuqsTestingAdapter>
);

const article = (id: string) => {
  const found = HELP_ARTICLES.find((a) => a.id === id);
  if (!found) throw new Error(`No article ${id}`);
  return found;
};

describe("matchesQuery", () => {
  it("finds an article by a word in its body, not only its title", () => {
    // Somebody searching "barcode" has not read the titles; the word they know
    // is in the prose.
    expect(matchesQuery(article("recording-your-first-sale"), "barcode")).toBe(
      true,
    );
  });

  it("finds the counter article for someone who calls it a till", () => {
    // The product never says "till". A shopkeeper does. That is what the
    // `keywords` list is for, and it is the difference between a search box
    // that works and one that is decorative.
    expect(matchesQuery(article("recording-your-first-sale"), "till")).toBe(
      true,
    );
  });

  it("finds the debt article for someone who calls it an IOU", () => {
    expect(matchesQuery(article("selling-on-credit"), "iou")).toBe(true);
  });

  it("narrows on a second word rather than widening", () => {
    const importing = article("importing-products");
    expect(matchesQuery(importing, "import spreadsheet")).toBe(true);
    // "import" alone matches; adding a word that does not appear must exclude
    // it. Matching ANY term instead of ALL would return this and feel broken.
    expect(matchesQuery(importing, "import passkey")).toBe(false);
  });

  it("ignores case and stray whitespace", () => {
    expect(matchesQuery(article("categories"), "  GENERAL  ")).toBe(true);
  });

  it("matches everything on an empty query", () => {
    expect(HELP_ARTICLES.every((a) => matchesQuery(a, ""))).toBe(true);
  });
});

describe("HelpCenter", () => {
  it("lists the articles under their sections", async () => {
    render(<HelpCenter />, { wrapper });

    expect(
      screen.getByRole("button", { name: /Recording your first sale/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("At the counter")).toBeInTheDocument();
    expect(screen.getByText("Products and stock")).toBeInTheDocument();
  });

  it("opens an article and can come back", async () => {
    render(<HelpCenter />, { wrapper });

    await userEvent.click(
      screen.getByRole("button", { name: /Restocking and adjusting stock/ }),
    );
    expect(
      screen.getByRole("heading", { name: "Restocking and adjusting stock" }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "All articles" }));
    expect(
      screen.getByRole("button", { name: /Recording your first sale/ }),
    ).toBeInTheDocument();
  });

  it("filters as you type and says so when nothing matches", async () => {
    render(<HelpCenter />, { wrapper });

    const box = screen.getByRole("searchbox", { name: /search help/i });
    await userEvent.type(box, "write off");
    expect(
      screen.getByRole("button", { name: /Writing off a debt/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Importing products/ }),
    ).not.toBeInTheDocument();

    await userEvent.clear(box);
    await userEvent.type(box, "zzzz");
    expect(screen.getByText(/Nothing here matches/)).toBeInTheDocument();
  });
});

describe("the articles themselves", () => {
  it("gives every article a unique id, since the id is the shareable link", () => {
    const ids = HELP_ARTICLES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not document a screen that does not exist yet", () => {
    // An article about a page the reader cannot open is a support ticket.
    // Reports, projects, announcements, team and settings used to be on this
    // list; they shipped on 2026-09-10 and were written up, which is what the
    // test below now enforces. What is left has no screen and no endpoint.
    const unbuilt = ["payslip", "payroll", "supplier", "expense"];
    for (const a of HELP_ARTICLES) {
      const prose = [a.title, a.summary].join(" ").toLowerCase();
      for (const word of unbuilt) {
        expect(prose).not.toContain(word);
      }
    }
  });

  it("has an article for every section of the product that has a screen", async () => {
    // The other half of the rule, and the half that rots silently: an article
    // missing for a shipped slice is invisible, where an article about an
    // unbuilt one is at least a broken promise somebody notices. The Help
    // Center was a full slice behind for a day because nothing checked this.
    //
    // Derived from `app/(app)/` rather than from a list typed here, because a
    // hand-written list is updated by the same person who would have
    // remembered to write the article. A new top-level page fails this test
    // until it has one.
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir("app/(app)", { withFileTypes: true });

    const areas = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("["))
      // `overview` is the front page every reader lands on and `help` is this
      // screen; neither is a subject somebody looks up.
      .filter((name) => !["overview", "help"].includes(name.name))
      // "sales" → "sale", "categories" → "categorie"; both are prefixes of
      // what an article would say, which is all the match needs.
      .map((entry) => entry.name.replace(/e?s$/, ""));

    const haystack = HELP_ARTICLES.map((article) =>
      [article.title, article.summary, ...article.keywords].join(" "),
    )
      .join(" ")
      .toLowerCase();

    const missing = areas.filter((area) => !haystack.includes(area));
    expect(missing).toEqual([]);
  });

  it("files every article under a section that is actually rendered", () => {
    // A typo in `section` would drop an article off the page silently — the
    // list is built by iterating HELP_SECTIONS, so an unknown section renders
    // nowhere at all rather than erroring.
    const known = new Set(HELP_SECTIONS.map((s) => s.id));
    for (const article of HELP_ARTICLES) {
      expect(known).toContain(article.section);
    }
  });
});
