import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PublicProject } from "../types";
import { PublicProjectView } from "./public-project-view";

const payload = (overrides: Partial<PublicProject> = {}): PublicProject => ({
  business: { name: "Hodan Hardware", logo: null },
  project: {
    title: "Storefront build",
    description: "New signage and paint",
    status: "in_progress",
    progress: 40,
    startDate: "2026-01-01T00:00:00.000Z",
    dueDate: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-09-10T09:00:00.000Z",
    cover: null,
  },
  updates: [
    {
      body: "Framing done",
      progress: 40,
      createdAt: "2026-09-09T09:00:00.000Z",
    },
  ],
  ...overrides,
});

describe("PublicProjectView", () => {
  it("renders the project the client came to see", () => {
    render(<PublicProjectView data={payload()} />);

    expect(
      screen.getByRole("heading", { name: "Storefront build" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Hodan Hardware")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
    // Twice: the project's own figure, and the badge on the note that set it.
    expect(screen.getAllByText("40%")).toHaveLength(2);
    expect(screen.getByText("Framing done")).toBeInTheDocument();
  });

  it("reads dates exactly as the payload writes them, in UTC", () => {
    // There is no session on this page and the payload carries no zone, so the
    // instant is rendered as written rather than shifted into the reader's
    // zone — which would make the same link say different things to different
    // people. `<time dateTime>` keeps the unmodified original.
    render(<PublicProjectView data={payload()} />);
    const start = screen.getByText("01 Jan 2026");
    expect(start).toHaveAttribute("dateTime", "2026-01-01T00:00:00.000Z");
  });

  it("shows a progress badge for 0 — a reset is news to a client", () => {
    render(
      <PublicProjectView
        data={payload({
          updates: [
            {
              body: "Back to the start",
              progress: 0,
              createdAt: "2026-09-09T09:00:00.000Z",
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("omits the badge when a note carried no progress", () => {
    render(
      <PublicProjectView
        data={payload({
          updates: [
            {
              body: "Just a note",
              progress: null,
              createdAt: "2026-09-09T09:00:00.000Z",
            },
          ],
        })}
      />,
    );
    // The project's own 40% is still on the page; the note has no badge.
    expect(screen.getAllByText(/%$/)).toHaveLength(1);
  });

  it("survives a business with no name — the API still answers 200", () => {
    // `business.name` is `""` when the organization row is gone
    // (`public-project.service.ts:46-47`).
    render(
      <PublicProjectView
        data={payload({ business: { name: "", logo: null } })}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Storefront build" }),
    ).toBeInTheDocument();
  });

  it('treats a description of "" as absent, not as an empty paragraph', () => {
    // A description cleared in the app is `""` on the wire, not `null`
    // (contract §1.3).
    const data = payload();
    data.project.description = "   ";
    render(<PublicProjectView data={data} />);
    expect(screen.queryByText("   ")).toBeNull();
  });

  it("says so plainly when a published project has no updates yet", () => {
    render(<PublicProjectView data={payload({ updates: [] })} />);
    expect(
      screen.getByText(/no updates have been posted yet/i),
    ).toBeInTheDocument();
  });

  it("renders nothing the payload does not carry", () => {
    // No id, no customer, no author, no publish state — and no way into an app
    // the reader has no account for.
    const { container } = render(<PublicProjectView data={payload()} />);
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(screen.queryByText(/customer/i)).toBeNull();
    expect(screen.queryByText(/posted by/i)).toBeNull();
    expect(screen.queryByText(/sign in/i)).toBeNull();
  });
});
