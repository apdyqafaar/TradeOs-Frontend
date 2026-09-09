import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { CartLineRow } from "@/features/sales/components/counter/cart-line";
import { type CartLine, useCartStore } from "@/features/sales/store/cart";

const rice: CartLine = {
  productId: "aaaaaaaaaaaaaaaaaaaaaaa1",
  name: "Basmati rice",
  unit: "kg",
  listPrice: 4.5,
  unitPrice: 4.5,
  quantity: 2,
  discount: 0,
};

/**
 * Subscribed to the store rather than holding the line in a prop: every control
 * on this row writes to the cart, and a test that passed a frozen `line` would
 * assert against a value the screen never showed.
 */
function Row({ error }: { error?: string } = {}) {
  const line = useCartStore((state) => state.lines[0]);
  if (!line) return <p>empty</p>;
  return <CartLineRow line={line} currency="USD" error={error} />;
}

const seed = (over: Partial<CartLine> = {}) => {
  useCartStore.setState({ lines: [{ ...rice, ...over }], orderDiscount: 0 });
};

const quantityBox = () =>
  screen.getByRole("textbox", { name: /quantity of basmati rice/i });

beforeEach(() => {
  useCartStore.getState().clear();
});

describe("CartLineRow — the quantity stepper", () => {
  it("steps by one in each direction", async () => {
    seed();
    render(<Row />);

    await userEvent.click(screen.getByRole("button", { name: /one more/i }));
    expect(useCartStore.getState().lines[0].quantity).toBe(3);

    await userEvent.click(screen.getByRole("button", { name: /one less/i }));
    expect(useCartStore.getState().lines[0].quantity).toBe(2);
  });

  it("will not step below one, because zero is not a quantity", () => {
    // `quantitySchema` is strictly positive — `0` is rejected outright, not
    // merely discouraged (`../Backend/src/lib/money.ts:42-47`). The floor is a
    // removal, which is what the bin is for.
    seed({ quantity: 1 });
    render(<Row />);

    expect(screen.getByRole("button", { name: /one less/i })).toBeDisabled();
  });

  it("cancels float noise, so a stepped weight is still three decimals", () => {
    // `0.118 + 1` is `1.1179999999999999` in binary floats. It survives
    // `isQuantity`'s tolerance, but it is what the box would then display —
    // sixteen digits of it, on a line sold by weight.
    seed({ quantity: 0.118 });
    render(<Row />);

    expect(quantityBox()).toHaveValue("0.118");
  });

  it("does not destroy a half-typed weight", async () => {
    // `type="number"` reports `""` for anything the browser calls invalid, and
    // `"1."` is invalid — the quantity would vanish for one keystroke.
    seed();
    render(<Row />);

    await userEvent.clear(quantityBox());
    await userEvent.type(quantityBox(), "1.");

    expect(quantityBox()).toHaveValue("1.");
    expect(useCartStore.getState().lines[0].quantity).toBe(1);
  });

  it("refuses to commit an emptied box, and restores it on the way out", async () => {
    seed();
    render(<Row />);

    await userEvent.clear(quantityBox());
    // Nothing is committed: an empty box is not a quantity this endpoint takes.
    expect(useCartStore.getState().lines[0].quantity).toBe(2);

    await userEvent.tab();
    expect(quantityBox()).toHaveValue("2");
  });

  it("drops a fourth decimal rather than rewriting what was typed", async () => {
    // A rewritten value moves the caret; the keystroke is simply not accepted.
    seed({ quantity: 1 });
    render(<Row />);

    await userEvent.clear(quantityBox());
    await userEvent.type(quantityBox(), "1.2345");

    expect(quantityBox()).toHaveValue("1.234");
  });
});

describe("CartLineRow — price and discount", () => {
  it("overrides the charged price without touching the list price", async () => {
    // `listPrice` is what lets `buildSalePayload` tell an override from an
    // untouched line and omit the untouched one.
    seed();
    render(<Row />);

    const price = screen.getByRole("textbox", { name: /unit price/i });
    await userEvent.clear(price);
    await userEvent.type(price, "4");

    expect(useCartStore.getState().lines[0]).toMatchObject({
      unitPrice: 4,
      listPrice: 4.5,
    });
  });

  it("settles a price at two decimals on blur", async () => {
    seed();
    render(<Row />);

    const price = screen.getByRole("textbox", { name: /unit price/i });
    await userEvent.clear(price);
    await userEvent.type(price, "4.5");
    await userEvent.tab();

    expect(price).toHaveValue("4.50");
  });

  it("takes a discount as an AMOUNT and shows what the line is worth", async () => {
    // Both discount fields on this endpoint are money, never percentages.
    seed();
    render(<Row />);

    const discount = screen.getByRole("textbox", { name: /discount on/i });
    await userEvent.clear(discount);
    await userEvent.type(discount, "1");

    // 4.50 x 2 - 1.00, computed by the store's transcription of
    // `sale.service.ts:155` and not by this component.
    expect(screen.getByText("USD 8.00")).toBeInTheDocument();
  });

  it("clearing the discount box is not a request for a zero discount", async () => {
    seed({ discount: 1 });
    render(<Row />);

    const discount = screen.getByRole("textbox", { name: /discount on/i });
    await userEvent.clear(discount);
    expect(useCartStore.getState().lines[0].discount).toBe(1);

    await userEvent.tab();
    expect(discount).toHaveValue("1.00");
  });
});

describe("CartLineRow — refusals and removal", () => {
  it("shows a shortfall on the row and marks the quantity as the thing to fix", () => {
    // Artboard `2a` puts `INSUFFICIENT_STOCK` on the offending line, not in a
    // toast: the sentence is about this row and the fix is the stepper on it.
    seed();
    render(<Row error="Only 0.5 kg in stock, and this line asks for 2 kg." />);

    expect(screen.getByText(/only 0\.5 kg in stock/i)).toBeInTheDocument();

    const box = quantityBox();
    expect(box).toHaveAttribute("aria-invalid", "true");
    // The message is beside the box for anyone who can see it; this is what
    // puts it in front of anyone who cannot.
    expect(box).toHaveAccessibleDescription(/only 0\.5 kg in stock/i);
  });

  it("removes the line", async () => {
    seed();
    render(<Row />);

    await userEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(useCartStore.getState().lines).toEqual([]);
  });
});
