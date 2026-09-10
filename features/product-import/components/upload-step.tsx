"use client";

import { cn } from "cn";
import { Download, Upload } from "lucide-react";
import { type DragEvent, useId, useState } from "react";
import { ErrorCard } from "@/components/shared/error-card";
import { Button } from "@/components/ui/button";
import { API_ERROR_CODE, type ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { useUploadImport } from "../hooks/use-import-mutations";
import * as importService from "../services/import.service";
import {
  IMPORT_ACCEPT_ATTRIBUTE,
  IMPORT_TEMPLATE_HEADERS,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
} from "../types";

/**
 * The two extensions the server can actually read, as a **courtesy check**.
 *
 * There is no `fileFilter` on the multer instance at all — no MIME allow-list
 * and no extension check on the way in — and CSV is the *fall-through* rather
 * than a match, so a `.xls`, a `.pdf` or a `.jpg` is parsed as CSV and dies at
 * `IMPORT_NO_ROWS` (contract Trap 11). "This file has no rows in it" is a
 * baffling thing to read about a real spreadsheet, so the sentence that names
 * the actual problem has to be produced here. It is a courtesy and not a
 * guarantee — magic bytes win over the extension server-side — which is why
 * every server refusal below is still rendered.
 */
const READABLE_EXTENSIONS = [".csv", ".xlsx"] as const;

/**
 * What each refusal means to someone holding their own spreadsheet.
 *
 * Keyed on `code`, never on `message` (CLAUDE.md): the messages are the API's
 * and change freely, and one of these — `IMPORT_NO_ROWS` above all — describes
 * a cause that is not what its raw message suggests.
 */
const REFUSALS: Record<string, string> = {
  [API_ERROR_CODE.IMPORT_FILE_TOO_LARGE]:
    "That file is over 5 MB. Saving the same rows as CSV instead of XLSX usually brings it well under, or you can split it and import the parts one after another.",
  [API_ERROR_CODE.IMPORT_UNSUPPORTED_FORMAT]:
    "We could not open that as a spreadsheet. Save it as .csv or .xlsx and try again.",
  [API_ERROR_CODE.IMPORT_NO_ROWS]:
    "We could not read any rows out of that file. It may be empty, it may hold only a header row, or it may not be a spreadsheet at all. Save it as .csv or .xlsx and try again.",
  [API_ERROR_CODE.IMPORT_TOO_MANY_ROWS]: `A file may hold at most ${MAX_IMPORT_ROWS.toLocaleString()} rows. Split it and import the parts one after another.`,
  // Twenty uploads per 15 minutes, keyed by **organization** rather than by
  // member (`product-import.route.ts:53`), which is worth saying out loud: a
  // colleague's failed attempts spend the same budget as your own.
  [API_ERROR_CODE.TOO_MANY_REQUESTS]:
    "This business has started twenty imports in the last fifteen minutes. Wait a few minutes and try again.",
};

const refusalCopy = (code: string, fallback: string): string =>
  REFUSALS[code] ?? fallback;

export interface UploadStepProps {
  /** Hand the new job's id back to the wizard, which puts it in the URL. */
  onUploaded: (jobId: ObjectId) => void;
}

/**
 * Step 1 — the drop zone, the size rule and the template link
 * (`docs/design/TradeOs-UI.dc.html:725-733`).
 *
 * ### Why there is a real `<input type="file">` and not a clickable div
 *
 * A `div` with an `onClick` that opens a picker is unreachable by keyboard and
 * invisible to a screen reader. The input here is `sr-only` — visually hidden,
 * but still focusable and still announced — and the upper block of the drop
 * zone is its `<label>`, so its accessible name is the design's own words plus
 * the size rule, and a pointer click anywhere in that block opens the picker.
 * The dashed border carries `focus-within`, so tabbing to the input shows a
 * ring on the thing the user is actually aiming at.
 *
 * "Download template" sits **outside** the label on purpose: a button nested
 * inside a label is a click target fighting with the label's own activation.
 */
export function UploadStep({ onUploaded }: UploadStepProps) {
  const uid = useId();
  const upload = useUploadImport();

  const [dragging, setDragging] = useState(false);
  /** A refusal this browser made, before anything went over the wire. */
  const [localIssue, setLocalIssue] = useState<string | null>(null);
  const [template, setTemplate] = useState<{
    busy: boolean;
    error: ApiError | null;
  }>({ busy: false, error: null });

  const send = (files: FileList | null) => {
    setLocalIssue(null);
    upload.reset();

    const file = files?.[0];
    if (!file) return;

    // `limits: { files: 1 }` server-side, which answers a generic 422 whose
    // message names a multipart field. Saying it plainly here is kinder.
    if (files.length > 1) {
      setLocalIssue("Drop one file at a time.");
      return;
    }

    const name = file.name.toLowerCase();
    if (!READABLE_EXTENSIONS.some((extension) => name.endsWith(extension))) {
      setLocalIssue(
        "We can read .csv and .xlsx files. Open this in your spreadsheet app and save it as one of those first.",
      );
      return;
    }

    // Multer aborts the stream when the ceiling is crossed, so the bytes are
    // already on the wire before the 413 comes back. Checking here is what
    // saves someone on a phone connection a pointless upload.
    if (file.size > MAX_IMPORT_BYTES) {
      setLocalIssue(REFUSALS[API_ERROR_CODE.IMPORT_FILE_TOO_LARGE] ?? "");
      return;
    }

    upload.mutate(file, { onSuccess: (job) => onUploaded(job.id) });
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    send(event.dataTransfer.files);
  };

  /**
   * `GET /products/import/template` answers raw `text/csv` with no JSON
   * envelope, so it cannot go through the shared axios client — and it does
   * not go through React Query either, because there is no server state here
   * to key, cache or invalidate, only a file to hand to the browser. That is
   * why this one call reaches the service directly with local pending and
   * error state instead of through a hook.
   */
  const getTemplate = async () => {
    setTemplate({ busy: true, error: null });
    try {
      const { filename, csv } = await importService.downloadTemplate();
      saveFile(filename, csv);
      setTemplate({ busy: false, error: null });
    } catch (error) {
      setTemplate({ busy: false, error: error as ApiError });
    }
  };

  const busy = upload.isPending;

  return (
    <div className="flex flex-col gap-3">
      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
        Step 1 · Upload
      </span>

      {/* biome-ignore lint/a11y/noStaticElementInteractions: the drag handlers
          are a pointer-only enhancement. The keyboard and assistive-tech path
          is the real <input type="file"> this block labels, which is why the
          handlers are not duplicated onto a role/tabIndex pair that would put
          a second, worse control in the tab order. */}
      <div
        data-slot="import-drop-zone"
        data-dragging={dragging ? "" : undefined}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center gap-2 rounded-[10px] border border-border-strong border-dashed bg-card p-9 text-center transition-colors",
          "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
          dragging && "border-primary bg-primary-soft",
        )}
      >
        <label
          htmlFor={`${uid}-file`}
          className="flex cursor-pointer flex-col items-center gap-2"
        >
          <span className="mb-1 flex size-11 items-center justify-center rounded-[10px] border border-border bg-muted">
            <Upload className="size-5 text-muted-3" aria-hidden="true" />
          </span>
          <span className="font-medium text-[14px] text-foreground">
            {busy ? "Reading your file…" : "Drop a CSV or XLSX here"}
          </span>
          <span className="font-mono text-[11px] text-muted-2">
            up to {MAX_IMPORT_ROWS.toLocaleString()} rows ·{" "}
            {MAX_IMPORT_BYTES / 1024 / 1024} MB
          </span>
        </label>

        <input
          id={`${uid}-file`}
          type="file"
          // Our UX choice, not a mirror of a server rule — the endpoint has no
          // MIME allow-list at all (contract Trap 11).
          accept={IMPORT_ACCEPT_ATTRIBUTE}
          disabled={busy}
          className="sr-only"
          onChange={(event) => {
            send(event.target.files);
            // Clearing the value means picking the same filename twice in a
            // row still fires `change` — which is exactly what someone does
            // after fixing the file a refusal complained about.
            event.target.value = "";
          }}
        />

        <Button
          type="button"
          variant="link"
          disabled={template.busy}
          onClick={() => void getTemplate()}
          className="mt-1 h-auto p-0 font-medium text-[13px]"
        >
          <Download className="size-3.5" aria-hidden="true" />
          {template.busy ? "Preparing…" : "Download template"}
        </Button>
      </div>

      {localIssue ? (
        <p
          role="alert"
          className="rounded-[10px] border border-warning/40 bg-warning-soft px-3.5 py-2.5 text-[13px] text-warning-strong"
        >
          {localIssue}
        </p>
      ) : null}

      {upload.error ? (
        <ErrorCard
          title="That file was not imported"
          // A 4xx refusal is the server's final answer, so there is no retry
          // button — pressing it would send the same file to the same rule.
          // The copy is ours, branched on `code`; the request id is the API's,
          // and it is the only thing support can trace.
          error={{
            ...upload.error,
            message: refusalCopy(upload.error.code, upload.error.message),
          }}
        />
      ) : null}

      {template.error ? (
        <ErrorCard
          title="Could not download the template"
          error={template.error}
          retry={() => void getTemplate()}
        />
      ) : null}

      <p className="text-[12px] text-muted-foreground">
        The template carries the headings we recognise:{" "}
        <span className="font-mono text-[11px]">
          {IMPORT_TEMPLATE_HEADERS.join(", ")}
        </span>
        . Your own headings are matched against those, and anything we cannot
        place is listed for you in the next step.
      </p>
    </div>
  );
}

/**
 * Hand a string to the browser as a downloaded file.
 *
 * The server already sets `Content-Disposition: attachment`, but the body is
 * read with `fetch` so that a failure can be normalised into an `ApiError`
 * carrying a request id — so the save has to be triggered from here. Guarded
 * because `URL.createObjectURL` does not exist in every environment this
 * renders in, and a missing template is not worth a thrown render.
 */
const saveFile = (filename: string, contents: string): void => {
  if (typeof URL.createObjectURL !== "function") return;

  const url = URL.createObjectURL(
    new Blob([contents], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};
