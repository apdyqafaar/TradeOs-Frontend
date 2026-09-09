import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  MoneyInput,
  type MoneyInputProps,
} from "@/components/shared/money-input";

/**
 * The field is controlled, so a test that renders it with a fixed `value`
 * would be testing a read-only box. This holds the number the way a real
 * caller does and reports every value the field emitted.
 */
function Harness({
  onChange,
  initial = null,
  ...props
}: Omit<MoneyInputProps, "value" | "onChange"> & {
  onChange?: (value: number | null) => void;
  initial?: number | null;
}) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <MoneyInput
      {...props}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

const box = () => screen.getByLabelText("Amount");

describe("MoneyInput", () => {
  it("reports a number, so no caller parses a string", async () => {
    const onChange = vi.fn();
    render(<Harness label="Amount" currency="USD" onChange={onChange} />);

    await userEvent.type(box(), "12.50");

    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last).toBe(12.5);
    expect(typeof last).toBe("number");
  });

  it("does not destroy a half-typed number", async () => {
    const onChange = vi.fn();
    render(<Harness label="Amount" currency="USD" onChange={onChange} />);

    await userEvent.type(box(), "12.");

    // The point survives the keystroke it was typed on — a `type="number"`
    // field hands back `""` here and the amount vanishes for one beat.
    expect(box()).toHaveValue("12.");
    expect(onChange).toHaveBeenLastCalledWith(12);
  });

  it("settles to two decimals only once the field is left", async () => {
    render(<Harness label="Amount" currency="USD" />);

    await userEvent.type(box(), "12.");
    await userEvent.tab();

    // Artboards `2a` and `2g` both draw the field at two decimals.
    expect(box()).toHaveValue("12.00");
  });

  it("refuses a third decimal rather than rewriting what was typed", async () => {
    render(<Harness label="Amount" currency="USD" />);

    await userEvent.type(box(), "12.345");

    // The keystroke is dropped; the caret and the first four characters stay
    // where they were.
    expect(box()).toHaveValue("12.34");
  });

  it("never accepts a negative amount", async () => {
    const onChange = vi.fn();
    render(<Harness label="Amount" currency="USD" onChange={onChange} />);

    await userEvent.type(box(), "-5");

    expect(box()).toHaveValue("5");
    for (const [value] of onChange.mock.calls) {
      expect(value === null || value >= 0).toBe(true);
    }
  });

  it("shows the max hint and fills it on the caller's own action", async () => {
    render(
      <Harness
        label="Amount"
        currency="USD"
        max={167.75}
        fillLabel="Pay in full"
      />,
    );

    // Artboard `2g`'s hint, with the code and never a symbol.
    expect(screen.getByText("max USD 167.75")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Pay in full" }));
    expect(box()).toHaveValue("167.75");
  });

  it("reports an amount over the max instead of silently clamping it", async () => {
    const onChange = vi.fn();
    render(
      <Harness
        label="Amount"
        currency="USD"
        max={167.75}
        onChange={onChange}
      />,
    );

    await userEvent.type(box(), "200");

    // Clamping would tell a shopkeeper their 200 was taken as 167.75. The
    // caller owns the refusal; the field owns saying so.
    expect(onChange).toHaveBeenLastCalledWith(200);
    expect(box()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("over the max of USD 167.75")).toBeInTheDocument();
  });

  it("converts a tender by multiplying, the way the backend prices it", async () => {
    render(
      <Harness
        label="Amount"
        currency="USD"
        mainCurrency="KES"
        exchangeRate={130}
      />,
    );

    await userEvent.type(box(), "100");

    // `formatExchange` multiplies, matching `toMain` in
    // `Backend/src/lib/money.ts`. Dividing would print KES 0.77 here.
    expect(screen.getByText("≈ KES 13,000.00 @ 130")).toBeInTheDocument();
  });

  it("says nothing about conversion when the tender is already the main currency", async () => {
    render(
      <Harness
        label="Amount"
        currency="KES"
        mainCurrency="KES"
        exchangeRate={130}
      />,
    );

    await userEvent.type(box(), "100");

    expect(screen.queryByText(/≈/)).not.toBeInTheDocument();
  });

  it("adopts a value the caller changed underneath it", () => {
    // The counter resets the field after a completed sale; the box has to
    // follow rather than hold the last tender.
    const { rerender } = render(
      <MoneyInput
        label="Amount"
        currency="USD"
        value={40}
        onChange={vi.fn()}
      />,
    );
    expect(box()).toHaveValue("40.00");

    rerender(
      <MoneyInput
        label="Amount"
        currency="USD"
        value={null}
        onChange={vi.fn()}
      />,
    );
    expect(box()).toHaveValue("");
  });

  it("names the currency for a reader who cannot see the toggle above it", () => {
    render(<Harness label="Amount" currency="KES" />);

    // The canvas puts no code inside the box, so this is the only thing that
    // tells a screen-reader user which currency they are typing.
    expect(box()).toHaveAccessibleDescription(/Amount in KES/);
  });
});
