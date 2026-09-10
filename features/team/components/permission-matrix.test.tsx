import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ALL_PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionMatrix } from "./permission-matrix";

describe("PermissionMatrix", () => {
  it("renders one checkbox per catalog permission when editable", () => {
    // 43 permissions, 43 controls. A permission with no box is one nobody can
    // ever grant, and the matrix is the only place they are granted.
    render(<PermissionMatrix value={new Set()} onChange={vi.fn()} />);

    expect(screen.getAllByRole("checkbox")).toHaveLength(
      ALL_PERMISSIONS.length,
    );
  });

  it("gives no focus stops at all in read-only mode", () => {
    // Presets open the same matrix read-only (the design says so, and PATCHing
    // one is a 403). Leaving 43 real checkboxes on screen would put 43 dead
    // tab stops between the reader and the rest of the page.
    render(<PermissionMatrix value={new Set(["members:view"])} />);

    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getByText("Can view members")).toBeInTheDocument();
    expect(screen.getByText("Cannot invite members")).toBeInTheDocument();
  });

  it("distinguishes a permission that does not exist from one not granted", () => {
    // THE third cell state. `payments` has no `view` and `uploads` has neither
    // `view` nor `delete` — `uploads:create` covers listing and deletion. An
    // unticked box there would promise something that can never be granted.
    render(<PermissionMatrix value={new Set()} />);

    expect(
      screen.getByText("There is no view permission for payments"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("There is no delete permission for uploads"),
    ).toBeInTheDocument();
    // And `reports` has only view, so four of its five cells are absent.
    expect(
      screen.getByText("There is no create permission for reports"),
    ).toBeInTheDocument();
  });

  it("labels both of the members specials, which share one drawn cell", () => {
    // The design's Special column has room for one box; `members` holds two
    // (invite and remove). Both are rendered, both are labelled.
    render(<PermissionMatrix value={new Set()} onChange={vi.fn()} />);

    expect(
      screen.getByRole("checkbox", { name: "invite members" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "remove members" }),
    ).toBeInTheDocument();
  });

  it("hands back a new Set rather than mutating the one it was given", async () => {
    const user = userEvent.setup();
    const value = new Set(["members:view"]);
    const onChange = vi.fn();

    render(<PermissionMatrix value={value} onChange={onChange} />);
    await user.click(screen.getByRole("checkbox", { name: "invite members" }));

    const next = onChange.mock.calls[0][0] as Set<string>;
    expect(next).not.toBe(value);
    expect([...next]).toEqual(["members:view", "members:invite"]);
    // The original is untouched, so React sees a new reference and re-renders.
    expect([...value]).toEqual(["members:view"]);
  });

  it("cannot produce a duplicate, which the backend would happily store", async () => {
    // A Set, not an array. The backend does not de-duplicate and caps the array
    // at 43, so an append-on-click implementation hits "Too big" long before
    // the user has picked 43 distinct permissions.
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <PermissionMatrix
        value={new Set(["members:view"])}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("checkbox", { name: "view members" }));

    const next = onChange.mock.calls[0][0] as Set<string>;
    expect(next.has("members:view")).toBe(false);
  });

  it("shows a granted permission as checked", () => {
    render(
      <PermissionMatrix
        value={new Set(["products:adjust_stock"])}
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("checkbox", { name: "adjust stock products" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "view products" }),
    ).not.toBeChecked();
  });
});
