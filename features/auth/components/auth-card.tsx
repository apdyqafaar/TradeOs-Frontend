import type { ReactNode } from "react";

/**
 * The 400px column every auth screen sits in.
 *
 * Artboard `1f` (`docs/design/TradeOs-UI.dc.html:2661`) draws it once and the
 * five undesigned screens — register, forgot/reset password, accept invite,
 * onboarding — inherit it: a 22px-gap column holding an 8px-gap header, the
 * screen's own body, and a centred footer line.
 *
 * No hooks, so it stays a Server Component and only the interactive body below
 * it pays for `"use client"`.
 */
export function AuthCard({
  headline,
  subtitle,
  footer,
  children,
}: {
  headline: ReactNode;
  subtitle?: ReactNode;
  /** The centred line under the body — "New to TradeOs? Create an account". */
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex w-full max-w-[400px] flex-col gap-[22px]">
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-[36px] leading-[1.08]">{headline}</h1>
        {subtitle ? (
          <p className="text-muted-foreground text-sm">{subtitle}</p>
        ) : null}
      </div>

      {children}

      {footer ? (
        <div className="text-center text-[13px] text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
