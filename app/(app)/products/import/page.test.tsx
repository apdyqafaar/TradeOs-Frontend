import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.fn();
vi.mock("@/lib/auth/require-page-access", () => ({
  requirePageAccess: () => access(),
}));

vi.mock("@/features/product-import/components/import-wizard", () => ({
  ImportWizard: () => <div>the wizard</div>,
}));

const Page = (await import("./page")).default;

beforeEach(() => {
  access.mockReset();
});

/**
 * The gate, not the markup.
 *
 * `app/(app)/layout.tsx` validates the session server-side on a full load, but
 * a layout does **not** re-render on a client-side navigation — and arriving
 * here from the Import button on `/products` is exactly that. So the page runs
 * its own check, and this asserts the two answers it can give.
 *
 * `lib/auth/require-page-access.test.ts` already walks `app/(app)` and fails
 * if any `page.tsx` forgets to call it; this covers what happens once it has.
 */
describe("the import page", () => {
  it("renders the wizard for a member who may create products", async () => {
    access.mockResolvedValue({ permitted: true, session: {} });

    render(await Page());
    expect(screen.getByText("the wizard")).toBeInTheDocument();
  });

  /**
   * A missing permission keeps the shell and shows the refusal inside it, so
   * the person can navigate somewhere they are allowed rather than being
   * bounced to a page with no explanation. Every one of the ten import
   * endpoints gates on `products:create`, and `ROUTE_PERMISSIONS` already keys
   * this path on it.
   */
  it("shows the refusal, not the wizard, when the permission is missing", async () => {
    access.mockResolvedValue({ permitted: false, session: {} });

    render(await Page());
    expect(screen.queryByText("the wizard")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      /don't have access/i,
    );
  });
});
