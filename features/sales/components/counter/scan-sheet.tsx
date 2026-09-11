"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Flashlight, FlashlightOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  type CameraScannerStatus,
  useCameraScanner,
} from "@/features/sales/hooks/use-camera-scanner";

/**
 * What each failure says to a shopkeeper, not to a developer.
 *
 * Every one of these is a normal outcome rather than an error: the phone has
 * no camera, somebody said no, another app has the lens. None of them is worth
 * an error card, and none of them stops the counter working — the field behind
 * this sheet still takes a laser scan or a typed barcode, which is why every
 * message says so rather than leaving the reader stuck.
 */
const STATUS_MESSAGES: Record<
  Exclude<CameraScannerStatus, "starting" | "scanning">,
  string
> = {
  paused: "Paused while you were in another app. Come back and it resumes.",
  denied:
    "This browser is not allowed to use the camera. Allow it in the site settings, or keep scanning with the handheld scanner.",
  "no-camera": "No camera on this device. The handheld scanner still works.",
  busy: "Another app is using the camera. Close it and try again.",
  failed:
    "The camera could not be started. The handheld scanner and typing the barcode both still work.",
};

export interface ScanSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Handed a decoded barcode exactly as the cashier's keystrokes would arrive.
   * The caller puts it through the same lookup a typed Enter uses.
   */
  onDecode: (value: string) => void;
}

/**
 * The camera scanner over the counter.
 *
 * **It decodes, and hands the value on. It does not look anything up.** The
 * catalog pane already owns one scan path — a burst of keystrokes ending in
 * Enter, resolved through `GET /products`'s search, which matches a name
 * prefix *or* an exact barcode — and a camera decode goes down that same path.
 * A second lookup here would be a second set of rules for what a scan means,
 * and the two would disagree the first time either changed.
 *
 * **The sheet closes on a decode.** A cashier scanning a tin wants the tin on
 * the receipt and the camera out of the way; leaving it open to scan a second
 * item sounds efficient and in practice means the lens keeps firing at the
 * shelf behind. Reopening is one tap.
 *
 * `useCameraScanner` releases the camera on close, on unmount, when the tab is
 * hidden, and when a `getUserMedia` promise resolves after its own effect was
 * torn down. The last one is not hypothetical: React 19 Strict Mode
 * double-invokes effects in development, and in production the same race
 * happens whenever this sheet is closed before the permission prompt is
 * answered.
 */
export function ScanSheet({ open, onOpenChange, onDecode }: ScanSheetProps) {
  const scanner = useCameraScanner({
    active: open,
    onDecode: (value) => {
      onDecode(value);
      onOpenChange(false);
    },
  });

  const message =
    scanner.status === "starting" || scanner.status === "scanning"
      ? null
      : STATUS_MESSAGES[scanner.status];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 flex w-[calc(100vw-2rem)] max-w-[440px] flex-col gap-4 rounded-[14px] border border-border bg-popover p-5 text-popover-foreground shadow-[0_12px_32px_rgba(31,30,29,0.18)] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <Dialog.Title className="font-serif text-2xl text-foreground leading-tight">
                Scan with the camera
              </Dialog.Title>
              <Dialog.Description className="text-[13px] text-muted-foreground">
                Hold the barcode inside the frame.
              </Dialog.Description>
            </div>

            <Dialog.Close
              aria-label="Close the camera"
              className="flex size-9 flex-none items-center justify-center rounded-[10px] text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <X className="size-[18px]" aria-hidden="true" />
            </Dialog.Close>
          </div>

          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[10px] bg-black">
            {/* `muted` and `playsInline` are both load-bearing on iOS-style
                policies: an unmuted video will not autoplay, and without
                `playsInline` the video takes over the whole screen. */}
            <video
              ref={scanner.videoRef}
              autoPlay
              muted
              playsInline
              className="size-full object-cover"
            />

            {/* The frame the reader aims with. `pointer-events-none` so it
                never eats a tap meant for the video beneath it. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
            >
              <div className="h-[38%] w-[78%] rounded-[8px] border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </div>

            {scanner.status === "starting" ? (
              <p className="absolute inset-x-0 bottom-0 bg-black/60 px-3 py-2 text-center text-[12px] text-white">
                Starting the camera…
              </p>
            ) : null}
          </div>

          {message ? (
            // `<output>` carries `role="status"` implicitly, so the sentence is
            // announced — the cashier is looking at the shelf, not the screen.
            <output className="block rounded-[10px] border border-border bg-muted px-3.5 py-3 text-[13px] text-muted-foreground leading-relaxed">
              {message}
            </output>
          ) : null}

          {scanner.torch.available ? (
            <Button
              type="button"
              variant="outline"
              onClick={scanner.torch.toggle}
              aria-pressed={scanner.torch.on}
              className="h-10 rounded-[10px] px-4 text-[13px]"
            >
              {scanner.torch.on ? (
                <FlashlightOff aria-hidden="true" />
              ) : (
                <Flashlight aria-hidden="true" />
              )}
              {scanner.torch.on ? "Turn off the light" : "Turn on the light"}
            </Button>
          ) : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
