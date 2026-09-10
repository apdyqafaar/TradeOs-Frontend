import type { VariantProps } from "class-variance-authority";
import { cn } from "cn";
import Link from "next/link";
import type { ComponentProps } from "react";
import { buttonVariants } from "@/components/ui/button";

/**
 * A link that looks like a button.
 *
 * **Not `<Button render={<Link />}>`.** Base UI's `Button` has exactly two
 * modes and neither is a link
 * (`@base-ui/react/internals/use-button/useButton.js:183-187`):
 *
 * ```js
 * isNativeButton ? { type: 'button' } : { role: 'button' }
 * ```
 *
 * - `nativeButton` left at its default `true` puts `type="button"` on the
 *   `<a>` — where `type` is a content-type hint and means nothing — and makes
 *   `isLink` compute false, so **Space activates the anchor** as if it were a
 *   button. Links activate on Enter; Space scrolls the page. It also logs a
 *   console error on every page that does it.
 * - `nativeButton={false}` silences the error and fixes the key handling by
 *   putting `role="button"` on the anchor, which is worse: assistive tech then
 *   announces a button, the element drops out of the page's list of links, and
 *   nothing about it suggests it can be opened in a new tab — which it still
 *   can, because it is still an anchor.
 *
 * So this renders a real `<Link>` and borrows the styling through the exported
 * `buttonVariants`. The result is an ordinary anchor: role link, Enter to
 * follow, Space to scroll, middle-click and right-click behaving as a reader
 * expects, and no invented attributes — styled identically, because it is the
 * same cva that dresses the button.
 *
 * `components/shared/button-as-link.test.ts` fails the build if a
 * `<Button render={<Link />}>` reappears.
 */
export function ButtonLink({
  className,
  variant,
  size,
  ...props
}: ComponentProps<typeof Link> & VariantProps<typeof buttonVariants>) {
  return (
    <Link
      data-slot="button-link"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}
