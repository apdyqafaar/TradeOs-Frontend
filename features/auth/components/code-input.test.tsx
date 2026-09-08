import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { CodeInput } from "./code-input";

function Harness() {
  const [value, setValue] = useState("");
  return (
    <>
      <CodeInput length={6} value={value} onChange={setValue} label="Code" />
      <output>{value}</output>
    </>
  );
}

describe("CodeInput", () => {
  it("advances focus as digits are typed", async () => {
    render(<Harness />);
    const boxes = screen.getAllByRole("textbox");
    await userEvent.type(boxes[0], "1");
    expect(boxes[1]).toHaveFocus();
  });

  it("accepts a pasted six-digit code across all boxes", async () => {
    render(<Harness />);
    const boxes = screen.getAllByRole("textbox");
    boxes[0].focus();
    await userEvent.paste("123456");
    expect(screen.getByRole("status")).toHaveTextContent("123456");
  });

  it("steps back on backspace in an empty box", async () => {
    render(<Harness />);
    const boxes = screen.getAllByRole("textbox");
    await userEvent.type(boxes[0], "1");
    await userEvent.keyboard("{Backspace}{Backspace}");
    expect(boxes[0]).toHaveFocus();
  });
});
