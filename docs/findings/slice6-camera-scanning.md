# Slice 6 — scanning a barcode with the camera

Built 2026-09-10 as part of `a55c93b`, and **corrected 2026-09-11** after the owner reported that
the camera never appeared on the machine the shop actually uses. This file exists mostly for that
correction: the original design was defensible, shipped with a green suite, and was wrong.

## 1. `BarcodeDetector` is an Android and ChromeOS API, and building on it alone hid the feature

**What:** camera scanning was written against the browser's own `BarcodeDetector`, and
`cameraSupport()` reported "this browser cannot scan" when it was absent. The Shape Detection API
has never shipped on desktop Chrome, on Firefox, or on any iOS browser. The practical effect was
that the camera button was **not rendered at all** on Windows, macOS, Linux and every iPhone —
including this shop's own counter PC, whose webcam was working the whole time.

**Evidence:** probed in the owner's browser on 2026-09-11 — Chrome 152 on Windows reports
`typeof window.BarcodeDetector === "undefined"` with `isSecureContext: true`,
`typeof navigator.mediaDevices.getUserMedia === "function"` and one camera
(`HP HD Camera (04f2:b58f)`). All three support conditions for a camera were met; only the decoder
was missing, and that was the one the code refused on.

**So what:** feature-detecting the API was right. Treating its absence as "no camera scanning" was
the mistake — a decoder is a library you can ship, not a platform capability you must wait for.
`cameraSupport()` now asks only the two questions it genuinely cannot answer for itself: is there a
camera API, and are we in a secure context.

### Why the tests were no help

happy-dom has no `BarcodeDetector` either, so the environment agreed with the bug. The suite
asserted the refusal and passed. **A test that asserts a refusal is only as good as the reason for
refusing** — this one encoded the wrong reason and then defended it.

`barcode-camera.test.ts` now opens with the inverse assertion: with no `BarcodeDetector` present,
`cameraSupport()` must come back `{ available: true }`. Break-tested — restoring the old
`&& createBarcodeDetector() !== null` reddens exactly that test and nothing else.

## 2. ZXing is the fallback, dynamically imported

**What:** `@zxing/library@0.23.0` decodes when the browser cannot. It is loaded with a dynamic
`import()` inside `loadZxingDetector()`, so it becomes its own chunk and nobody who never opens the
camera pays to download it — the counter is the screen a shift starts on.

**Evidence:** `features/sales/lib/barcode-camera.ts`. `loadDetector()` is
`createBarcodeDetector() ?? (await loadZxingDetector())` — native first, because where it exists it
is hardware-accelerated and free.

**So what:** the seam is `BarcodeDetectorLike`, an interface with one method. The frame loop, the
repeat guard and the stream lifecycle in `use-camera-scanner.ts` are written once and neither knows
which decoder it has.

### Two things this build of ZXing does not have

- **No 1D writers.** `MultiFormatWriter` in 0.23 wires up `QRCodeWriter` and nothing else; every
  other branch of its `switch` is commented out, and `EAN13Writer`/`Code128Writer` are not in the
  package at all. `encode()` answers `No encoder available for format 7` for EAN-13. This matters
  only for tests — the fixtures in `barcode-camera.test.ts` encode EAN-13 and Code 39 by hand for
  that reason.
- **`RGBLuminanceSource` takes one byte per pixel**, not four. `getImageData` gives four, so the
  RGBA is packed to Rec. 601 luma first. Handing it the raw array reads the alpha channel as
  brightness.

### ITF-14 is excluded on purpose, in both decoders

A shop's shelves carry EAN-13/8, UPC-A/E and the Code 128/39 its own label printer emits. ITF-14 is
a **carton** code: scanning the outer box would ring up one unit for a case of twelve. QR and Data
Matrix are left out too — packaging carries payment QRs centimetres from the EAN, and decoding one
hands the counter a URL to look up as a product.

## 3. Verified by driving a real barcode through the real browser

**What:** the scanner was proven end to end on 2026-09-11 without anyone holding a packet to a
webcam — a canvas was drawn with the EAN-13 of a seeded product and piped into the live `<video>`
via `canvas.captureStream(15)`, replacing the camera's frames while the scanner ran.

**Evidence:** with `6291041500435` (AA batteries 4pk) on the canvas, the sheet closed on its own and
the cart read `CART · 1 LINE — AA batteries 4pk — ETB 95.00`. Afterwards the **camera** track
(`window.__camStream`, kept aside before the swap) read `readyState: "ended"`.

**So what:** this covers the one thing the unit tests cannot — `drawImage` off a real video element,
which needs a compositor happy-dom does not have. It also confirmed in a real browser that closing
the sheet releases the lens, which until then was only asserted against a stand-in stream. Worth
reusing: it is a repeatable way to test any camera feature without props or a human.

## 4. A decode goes down the same path as a keystroke

**What:** `ScanSheet` decodes and hands the value to `onDecode`; it looks nothing up. The catalog
pane already resolves a scan through `GET /products?search=`, which matches a name prefix *or* an
exact barcode, and a camera decode is fed to that same handler.

**So what:** there is one definition of what a scan means. A dedicated `GET /products/barcode/:code`
exists and is deliberately unused here — adopting it would give the camera different lookup rules
from the handheld scanner, and the two would disagree the first time either changed.

## 5. What is still only reasoned about, not observed

The repeat guard (`REPEAT_GUARD_MS`) and the torch are covered by tests and by argument, but have
not been exercised against a real phone camera — the synthetic-frame method above holds one image
perfectly still, which is not how a hand presents a packet. Neither is a correctness risk; both are
tuning that wants a real Android device in a real shop before the numbers are trusted.
