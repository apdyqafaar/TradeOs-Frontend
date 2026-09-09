import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Customer } from "@/features/customers/types";
import { ApiError } from "@/lib/api/errors";
import { CustomerFormSheet } from "./customer-form-sheet";

const createMutate = vi.fn();
const updateMutate = vi.fn();
vi.mock("@/features/customers/hooks/use-customer-mutations", () => ({
  useCreateCustomer: () => ({
    mutate: createMutate,
    isPending: false,
    error: null,
  }),
  useUpdateCustomer: () => ({
    mutate: updateMutate,
    isPending: false,
    error: null,
  }),
}));

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);

const bakaara: Customer = {
  id: "cu1",
  name: "Bakaara Wholesale",
  phone: "+252612207781",
  email: "buy@bakaara.so",
  address: "Bakaara Market, Mogadishu",
  status: "active",
  createdAt: "2026-09-01T08:00:00.000Z",
  updatedAt: "2026-09-01T08:00:00.000Z",
};

beforeEach(() => {
  createMutate.mockReset();
  updateMutate.mockReset();
});

describe("CustomerFormSheet — creating", () => {
  it("will not submit without a phone number", async () => {
    render(wrap(<CustomerFormSheet open onOpenChange={vi.fn()} />));
    await userEvent.type(screen.getByLabelText("Name"), "Faisal Traders");
    await userEvent.click(
      screen.getByRole("button", { name: /save customer/i }),
    );

    /*
     * The plan's draft asserted `findByText(/phone/i)`, which matches the
     * field's own label as well as its message and so throws on multiple
     * elements. The message is what this test is about, so it is matched
     * exactly.
     */
    expect(
      await screen.findByText(/enter a phone number of at least 5 digits/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Phone")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("hands the created customer back, so the counter can select it", async () => {
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    createMutate.mockImplementationOnce(
      (_input: unknown, opts?: { onSuccess?: (c: Customer) => void }) =>
        opts?.onSuccess?.({ ...bakaara, id: "cu2", name: "Faisal Traders" }),
    );

    render(
      wrap(
        <CustomerFormSheet
          open
          onOpenChange={onOpenChange}
          onCreated={onCreated}
        />,
      ),
    );
    await userEvent.type(screen.getByLabelText("Name"), "Faisal Traders");
    await userEvent.type(screen.getByLabelText("Phone"), "0712345678");
    await userEvent.click(
      screen.getByRole("button", { name: /save customer/i }),
    );

    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cu2" }),
    );
    // The sheet closes itself, so a caller that only wants the list refreshed
    // does not have to do it from `onCreated`.
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("omits a blank address rather than storing an empty string", async () => {
    render(wrap(<CustomerFormSheet open onOpenChange={vi.fn()} />));
    await userEvent.type(screen.getByLabelText("Name"), "Faisal Traders");
    await userEvent.type(screen.getByLabelText("Phone"), "0712345678");
    await userEvent.click(
      screen.getByRole("button", { name: /save customer/i }),
    );

    // `address` and `notes` accept `""` — the schema allows it so a PATCH can
    // clear them — but on a create a blank box means "not provided".
    expect(createMutate).toHaveBeenCalledWith(
      { name: "Faisal Traders", phone: "0712345678" },
      expect.anything(),
    );
  });

  it("puts a DUPLICATE_PHONE conflict on the phone field, not in a banner", async () => {
    createMutate.mockImplementationOnce(
      (_input: unknown, opts?: { onError?: (e: ApiError) => void }) =>
        opts?.onError?.(
          new ApiError({
            message: "A customer with this phone number already exists.",
            status: 409,
            code: "DUPLICATE_PHONE",
          }),
        ),
    );

    render(wrap(<CustomerFormSheet open onOpenChange={vi.fn()} />));
    await userEvent.type(screen.getByLabelText("Name"), "Faisal Traders");
    await userEvent.type(screen.getByLabelText("Phone"), "0712445900");
    await userEvent.click(
      screen.getByRole("button", { name: /save customer/i }),
    );

    const phone = await screen.findByLabelText("Phone");
    expect(phone).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText(/a customer with this phone number already exists/i),
    ).toBeInTheDocument();
  });
});

describe("CustomerFormSheet — editing", () => {
  it("seeds the form from the customer and sends only what changed", async () => {
    render(
      wrap(
        <CustomerFormSheet open onOpenChange={vi.fn()} customer={bakaara} />,
      ),
    );

    expect(screen.getByLabelText("Name")).toHaveValue("Bakaara Wholesale");

    const address = screen.getByLabelText(/address/i);
    await userEvent.clear(address);
    await userEvent.type(address, "Hamarweyne, Mogadishu");
    await userEvent.click(
      screen.getByRole("button", { name: /save customer/i }),
    );

    // A PATCH says "change what I sent". Re-sending the four untouched fields
    // is how one tab's stale value overwrites another tab's edit.
    expect(updateMutate).toHaveBeenCalledWith(
      { id: "cu1", input: { address: "Hamarweyne, Mogadishu" } },
      expect.anything(),
    );
  });

  it("refuses to send an empty PATCH when nothing was touched", async () => {
    render(
      wrap(
        <CustomerFormSheet open onOpenChange={vi.fn()} customer={bakaara} />,
      ),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /save customer/i }),
    );

    // The backend answers 422 "Nothing to update" to an empty body; the
    // schema's refinement mirrors it, so the round trip never happens.
    expect(await screen.findByText(/nothing has changed/i)).toBeInTheDocument();
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("says an email cannot be cleared instead of dropping the change in silence", async () => {
    render(
      wrap(
        <CustomerFormSheet open onOpenChange={vi.fn()} customer={bakaara} />,
      ),
    );
    await userEvent.clear(screen.getByLabelText(/email/i));
    await userEvent.click(
      screen.getByRole("button", { name: /save customer/i }),
    );

    // `PATCH /customers/:id` validates `email` with `.email()`, so `""` is a
    // 422 and an omitted key means "leave it alone" — there is no way to
    // express "remove it". Saying so beats closing on an edit that did not
    // happen.
    expect(
      await screen.findByText(/can't be removed once it is set/i),
    ).toBeInTheDocument();
    expect(updateMutate).not.toHaveBeenCalled();
  });
});
