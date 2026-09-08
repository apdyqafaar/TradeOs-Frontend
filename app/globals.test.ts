import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

const block = (selector: string): string => {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block in globals.css`);
  const end = css.indexOf("\n}", start);
  return css.slice(start, end);
};

const token = (selector: string, name: string): string | undefined =>
  new RegExp(`${name}:\\s*([^;]+);`).exec(block(selector))?.[1]?.trim();

const TERRACOTTA = "oklch(0.6724 0.1308 38.76)";

describe("design tokens", () => {
  it("uses the canvas terracotta for the active nav pill, not a darkened variant", () => {
    // Owner decision, 2026-09-07: the design canvas wins over WCAG contrast on
    // the accent. #D97757 on #F6E7DF is 2.6:1 and that is intentional — the
    // canvas renders it that way at docs/design/TradeOs-UI.dc.html:2102.
    // If this test fails, someone has "fixed" the contrast. Ask before changing.
    expect(token(":root", "--sidebar-accent-foreground")).toBe(TERRACOTTA);
    expect(token(":root", "--primary-soft-foreground")).toBe(TERRACOTTA);
    expect(token(":root", "--primary")).toBe(TERRACOTTA);
  });

  it("defines every extra token the canvas uses, in both themes", () => {
    const extras = [
      "--muted-2",
      "--muted-3",
      "--surface-2",
      "--surface-3",
      "--border-strong",
      "--success-strong",
      "--warning-strong",
      "--info-strong",
      "--destructive-strong",
    ];
    for (const name of extras) {
      expect(token(":root", name), `${name} missing from :root`).toBeDefined();
      expect(token(".dark", name), `${name} missing from .dark`).toBeDefined();
    }
  });

  it("exposes the extra tokens to Tailwind so bg-surface-2 and friends compile", () => {
    const theme = block("@theme inline");
    for (const name of [
      "--color-muted-2",
      "--color-muted-3",
      "--color-surface-2",
      "--color-surface-3",
      "--color-border-strong",
      "--color-success-strong",
      "--color-warning-strong",
      "--color-info-strong",
      "--color-destructive-strong",
    ]) {
      expect(theme, `${name} not exposed in @theme inline`).toContain(name);
    }
  });
});
