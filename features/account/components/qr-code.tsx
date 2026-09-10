"use client";

import { cn } from "cn";
import { encodeQr } from "@/features/account/lib/qr";

/**
 * The `otpauth://` URI as a scannable code — artboard `2k`
 * (`docs/design/TradeOs-UI.dc.html:1421-1424`).
 *
 * **SVG, not a canvas or an image.** A canvas would need an effect, a ref and a
 * device-pixel-ratio dance to stay crisp; an `<img>` would need a data URI,
 * which puts a credential-bearing string somewhere a right-click can save it
 * and a screenshot tool can index it. Rects on a path scale losslessly, print
 * correctly, and are gone from the DOM the moment the dialog closes.
 *
 * **`shape-rendering="crispEdges"`** because the browser's default antialiasing
 * puts a half-pixel grey seam between adjacent modules, and a camera reading a
 * small code on a phone screen resolves those seams as noise.
 *
 * The **quiet zone is not optional.** The spec asks for four modules of light
 * margin on every side and scanners genuinely fail without it, which is why it
 * is baked into the viewBox rather than left to whatever padding the caller
 * happens to have.
 *
 * The URI itself is never logged, never put in an attribute a screenshot tool
 * reads, and not exposed as the `alt` text — the accessible name says what the
 * image is for, because reading a base32 secret aloud helps nobody.
 */
const QUIET_ZONE = 4;

export function QrCode({
  value,
  className,
  title = "QR code for your authenticator app",
}: {
  /** The `otpauth://` URI, verbatim. */
  value: string;
  className?: string;
  title?: string;
}) {
  let matrix: ReturnType<typeof encodeQr>;
  try {
    matrix = encodeQr(value);
  } catch {
    // The encoder throws rather than truncating, because a truncated QR still
    // scans and enrols the wrong secret. The manual-entry key beside this is a
    // complete fallback, so the panel stays usable — it just loses the picture.
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-lg border border-border bg-background p-3 text-center text-[11px] text-muted-foreground",
          className,
        )}
      >
        Enter the key by hand — this code could not be drawn.
      </div>
    );
  }

  const span = matrix.size + QUIET_ZONE * 2;
  const path: string[] = [];
  for (let row = 0; row < matrix.size; row += 1) {
    for (let col = 0; col < matrix.size; col += 1) {
      if (matrix.modules[row][col]) {
        path.push(`M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`);
      }
    }
  }

  return (
    <svg
      role="img"
      aria-label={title}
      viewBox={`0 0 ${span} ${span}`}
      shapeRendering="crispEdges"
      className={cn("size-24 rounded-lg border border-border", className)}
    >
      <title>{title}</title>
      {/*
        Painted white rather than left transparent, and dark modules painted
        black — not `--foreground` over `--card`. A QR code is read by a camera
        measuring contrast, not by a person reading a theme: in dark mode the
        token pair inverts the code, and an inverted QR is unreadable to most
        scanners. This is the one place in the app where a hardcoded colour is
        the correct answer, and it is why the rule about tokens does not apply.
      */}
      <rect width={span} height={span} fill="#ffffff" />
      <path d={path.join("")} fill="#000000" />
    </svg>
  );
}
