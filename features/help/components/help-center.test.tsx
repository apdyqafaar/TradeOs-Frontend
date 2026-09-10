import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { HELP_ARTICLES } from "@/features/help/content";
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
    // An article about a page the reader cannot open is a support ticket. The
    // unbuilt slices are reports, projects, announcements, team and settings;
    // when one ships, its article can be written and this list shortened.
    const unbuilt = ["report", "project", "announcement", "payslip"];
    for (const a of HELP_ARTICLES) {
      const prose = [a.title, a.summary].join(" ").toLowerCase();
      for (const word of unbuilt) {
        expect(prose).not.toContain(word);
      }
    }
  });
});
