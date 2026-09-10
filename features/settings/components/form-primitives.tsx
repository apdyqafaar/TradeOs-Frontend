"use client";

import { cn } from "cn";
import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

/**
 * The handful of shapes artboard `2k` draws over and over on both of this
 * slice's screens: a panel, a labelled field with its error line, and the
 * 44px-tall control inside it (`docs/design/TradeOs-UI.dc.html:1336-1358`).
 *
 * Kept here and imported by `features/account` as well, rather than copied
 * into both. Settings and Account are one slice and one artboard, and these
 * two screens sit side by side in the design; a divergence between them would
 * be a visible bug rather than an abstraction leak. They are **not** promoted
 * to `components/ui/` — that directory is vendored shadcn and is regenerated,
 * not hand-edited.
 */

/**
 * The 44px control from the canvas, applied to a native `<input>`,
 * `<select>` or `<textarea>`.
 *
 * A string rather than a component so the caller keeps its own element and
 * every native attribute that goes with it — `type`, `inputMode`,
 * `autoComplete`, `maxLength`. A password field in particular must stay a real
 * `<input type="password">` with the right `autoComplete` token so browser
 * password managers behave, and wrapping it would be the easiest way to lose
 * that.
 */
export const CONTROL =
  "h-11 w-full rounded-[10px] border border-border bg-background px-3 text-sm text-foreground transition-colors focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20";

/** The same control for a `<select>`, whose native arrow the canvas replaces. */
export const SELECT_CONTROL = cn(CONTROL, "appearance-none pr-9");

/**
 * A panel: the pale inner card every group on `2k` sits in
 * (`#FBFAF7` over the screen's `#F5F4EE`, 10px radius, 1px border).
 */
export function SettingsPanel({
  title,
  description,
  action,
  children,
  className,
}: {
  /** Omit for an unlabelled group; the canvas has both kinds. */
  title?: ReactNode;
  description?: ReactNode;
  /** Sits opposite the title — a status pill, or a button. */
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-4 rounded-[10px] border border-border bg-card p-5",
        className,
      )}
    >
      {title || action ? (
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            {title ? (
              <h3 className="font-medium text-foreground text-sm">{title}</h3>
            ) : null}
            {description ? (
              <p className="text-muted-foreground text-xs">{description}</p>
            ) : null}
          </div>
          {action ? <div className="flex-none">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/**
 * A labelled field with its own error line.
 *
 * `error` drives both the message and the `aria-describedby` wiring, which is
 * why the control is passed as a render prop taking the ids rather than as
 * children: a message that is only visible is invisible to a screen reader,
 * and the two ids are the only thing connecting them.
 */
export function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: ReactNode;
  /** Shown only when there is no error — an error replaces it, never stacks. */
  hint?: ReactNode;
  error?: string;
  children: (props: {
    id: string;
    "aria-invalid": true | undefined;
    "aria-describedby": string | undefined;
  }) => ReactNode;
  className?: string;
}) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
      })}
      {error ? (
        <p id={errorId} className="text-[13px] text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The blue note from the canvas (`TradeOs-UI.dc.html:1315-1318,1372-1375`):
 * a hairline over a pale ground, for a consequence the person should know
 * before they act. `--info-strong` is the token pair legible on `--info-soft`
 * in both themes; `border-info/30` matches how the destructive panels in this
 * repo draw their edge, since there is no `--info-border`.
 */
export function InfoNote({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "rounded-[10px] border border-info/30 bg-info-soft px-3.5 py-2.5 text-[13px] text-info-strong",
        className,
      )}
    >
      {children}
    </p>
  );
}

/**
 * The same shape in the destructive palette, for a refusal or a warning.
 *
 * `role="alert"` is fixed rather than configurable. Everything rendered through
 * this is a refusal the person needs told about immediately — a rejected
 * password, a 409, a rate limit — and a caller that softened it to `status`
 * would produce a message a screen-reader user reaches only by wandering back
 * over the form.
 */
export function AlertNote({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      role="alert"
      className={cn(
        "rounded-[10px] border border-destructive/30 bg-destructive-soft px-3.5 py-2.5 text-[13px] text-destructive-strong",
        className,
      )}
    >
      {children}
    </p>
  );
}

/**
 * The caret the canvas draws inside a `<select>`.
 *
 * Hand-drawn rather than a `lucide` icon because `SELECT_CONTROL` sets
 * `appearance-none` — which removes the native arrow — and this has to sit at
 * exactly the inset the canvas uses. Absolutely positioned, so its parent needs
 * `relative`; `pointer-events-none` keeps a click on the caret opening the
 * select underneath it rather than landing on the glyph.
 */
export function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 14 14"
      className={cn(
        "-translate-y-1/2 pointer-events-none absolute top-1/2 right-3 size-3.5 text-muted-foreground",
        className,
      )}
    >
      <path
        d="M3 5.5 7 9.5 11 5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * And in the success palette, for "that worked" copy that should linger.
 *
 * An `<output>`, not a `<p role="status">`. It carries the same implicit live
 * region — an assistive technology announces it when its text changes, which is
 * exactly what "saved" needs — while being the element the role was derived
 * from. These panels are only ever mounted after a mutation resolves, so the
 * announcement lands when the person acted rather than on first paint.
 */
export function SuccessNote({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <output
      className={cn(
        "block rounded-[10px] border border-success/30 bg-success-soft px-3.5 py-2.5 text-[13px] text-success-strong",
        className,
      )}
    >
      {children}
    </output>
  );
}
