"use client";

import { cn } from "cn";
import { Pin } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useCan } from "@/features/auth/hooks/use-permission";
import { ImagePicker } from "@/features/uploads/components/image-picker";
import {
  API_ERROR_CODE,
  type ApiError,
  fieldErrorsFor,
} from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { PERMISSIONS } from "@/lib/auth/permissions";
import {
  useCreateAnnouncement,
  useUpdateAnnouncement,
} from "../hooks/use-announcement-mutations";
import {
  announcementPatch,
  createAnnouncementSchema,
  FORM_LEVEL_ERROR_KEY,
  updateAnnouncementSchema,
} from "../schemas/announcement.schema";
import type { Announcement } from "../types";

const CONTROL =
  "w-full rounded-[10px] border border-border bg-background px-3 py-2 text-[14px] text-foreground transition-colors placeholder:text-muted-3 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20";

/** Every refusal this sheet can show, addressed to the control that can fix it. */
interface Issues {
  title?: string;
  body?: string;
  pinned?: string;
  cover?: string;
  /** A refusal with no field to fix. Rendered above the actions. */
  form?: string;
}

/**
 * Which control a 422's `errors` key belongs to.
 *
 * `satisfies Record<…, keyof Issues>` is the point of the constant: it is a
 * **compile-time** assertion that this form routes every key the body actually
 * has, and only those. If the wire shape drifted, this stops compiling rather
 * than silently dropping the server's message about a field nobody renders.
 *
 * `FORM_LEVEL_ERROR_KEY` — the literal `"_"` — is in the map for the same
 * reason it exists at all: an object-level zod issue has an empty path, and
 * `zodToFieldErrors` keys an empty path `"_"` (`error.middleware.ts:12`). That
 * is what an empty `PATCH {}` comes back as, and without a row here the
 * message "At least one field must be provided" would be looked up against a
 * control called `_`, find nothing, and vanish.
 */
const ISSUE_FOR_FIELD = {
  title: "title",
  body: "body",
  pinned: "pinned",
  coverUploadId: "cover",
  [FORM_LEVEL_ERROR_KEY]: "form",
} as const satisfies Record<string, keyof Issues>;

export interface AnnouncementFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Omitted to create, supplied to edit. The whole row, not just an id: the
   * form needs `cover.uploadId` and `cover.thumbUrl` (the upload gallery only
   * lists *unattached* images, so a saved cover cannot be looked up there) and
   * `announcementPatch` diffs against every field of it.
   */
  announcement?: Announcement;
  /** Called with the saved row. Create uses it to navigate to the new notice. */
  onSaved?: (announcement: Announcement) => void;
}

/**
 * Write or edit a notice — artboard `2m`'s form sheet.
 *
 * **Create and edit are one sheet on purpose**, because they are one shape:
 * `POST` and `PATCH` take the same four keys and answer the same row. What
 * differs is the *body-building rule*, and that difference is the whole reason
 * this component is careful:
 *
 *   - **Create** sends everything. `pinned` has the feature's only `.default()`
 *     (`false`), so a create body is legal with just a title and a body.
 *   - **Edit** sends only what changed, built by `announcementPatch`. Two
 *     values there are real and must survive the diff: `pinned: false` (the
 *     unpin) and `coverUploadId: null` (delete the image). A truthiness filter
 *     over the diff would drop exactly those two.
 *   - **An edit that changed nothing is not sent at all.** `announcementPatch`
 *     answers `null` and the sheet just closes, because `PATCH {}` is a
 *     deliberate 422 whose message arrives under the field key `"_"` — a
 *     mystery error on a form the user believes they left alone (contract trap
 *     5, live guard `announcements.test.ts:209-222`).
 *
 * **The cover is real and it is destructive.** Attaching runs inside the write's
 * own transaction, so a bad upload id rolls the whole announcement back and
 * nothing is half-saved (`attachments.service.ts:36-68`). Replacing or clearing
 * one **permanently deletes** the old image from storage — there is no recently-
 * removed gallery — which is why the copy under the picker says so rather than
 * calling it "remove".
 *
 * The picker is hidden without `uploads:create`, not disabled. All three upload
 * routes are gated on it and there is no `uploads:view`, so a role that cannot
 * upload cannot even list the gallery. `useCan` rather than `<PermissionGate>`
 * because that component renders nothing while the session loads, which would
 * make the picker pop in after the rest of the form has settled.
 *
 * Nothing here is a toast: a refusal lands under the control that caused it
 * (brief §8.4), and the ones with no field — a 403 from a role that changed
 * mid-session, a dead network — get the panel above the buttons.
 */
export function AnnouncementFormSheet({
  open,
  onOpenChange,
  announcement,
  onSaved,
}: AnnouncementFormSheetProps) {
  const uid = useId();
  const mode = announcement ? "edit" : "create";

  const create = useCreateAnnouncement();
  const update = useUpdateAnnouncement();
  const canUpload = useCan(PERMISSIONS.UPLOADS_CREATE);

  const [title, setTitle] = useState(announcement?.title ?? "");
  const [body, setBody] = useState(announcement?.body ?? "");
  const [pinned, setPinned] = useState(announcement?.pinned ?? false);
  const [coverUploadId, setCoverUploadId] = useState<ObjectId | null>(
    announcement?.cover?.uploadId ?? null,
  );
  const [issues, setIssues] = useState<Issues>({});

  /*
   * Reset when the sheet opens, keyed on the row it opened over.
   *
   * An effect rather than a `key` on the caller, because the caller renders one
   * sheet for both "New announcement" and "Edit this one" — remounting on every
   * open would also discard the mutation state that renders the pending label.
   * Depending on `announcement?.id` and not on the object means a background
   * refetch that replaces the row with an equal one does not wipe what the user
   * has typed.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the announcement's fields are this effect's output, not its input — depending on them would reset the form under the user on every background refetch
  useEffect(() => {
    if (!open) return;
    setTitle(announcement?.title ?? "");
    setBody(announcement?.body ?? "");
    setPinned(announcement?.pinned ?? false);
    setCoverUploadId(announcement?.cover?.uploadId ?? null);
    setIssues({});
  }, [open, announcement?.id]);

  const busy = create.isPending || update.isPending;

  const close = () => onOpenChange(false);

  /**
   * Route a failure to the control that can fix it.
   *
   * Branching on `code`, never on `message` (CLAUDE.md). The three cover codes
   * are the only 409s reachable from this form — announcements themselves have
   * **no** domain conflict at all (contract §7) — and each one is fixed at the
   * image picker, which is where they are shown.
   */
  const failed = (error: ApiError) => {
    switch (error.code) {
      case API_ERROR_CODE.UPLOAD_PURPOSE_MISMATCH:
        setIssues({
          cover:
            "That image was uploaded for something else. Pick or upload one here instead.",
        });
        return;
      case API_ERROR_CODE.UPLOAD_ATTACHED:
        setIssues({
          cover:
            "That image is already used by something else. Pick a different one, or upload it again.",
        });
        return;
      case API_ERROR_CODE.NOT_FOUND:
        // Two causes, one code. With a cover selected the far likelier one is
        // the upload — an announcement id only 404s if somebody deleted the
        // notice while this sheet was open, which the message also covers.
        setIssues(
          coverUploadId
            ? { cover: "That image is no longer available. Pick another one." }
            : {
                form: "This announcement no longer exists — someone deleted it while this was open.",
              },
        );
        return;
      default:
        break;
    }

    // A 422's field errors, mapped through the table above so an unrouted key
    // cannot silently disappear.
    const fields = fieldErrorsFor(error);
    const routed: Issues = {};
    let unrouted = false;
    for (const [field, message] of Object.entries(fields)) {
      const slot = ISSUE_FOR_FIELD[field as keyof typeof ISSUE_FOR_FIELD];
      if (slot) routed[slot] = message;
      else unrouted = true;
    }

    // A key this form does not render still has to reach the user. Silence here
    // is how a form becomes un-submittable for a reason nobody can see.
    if (unrouted || Object.keys(routed).length === 0) {
      routed.form = routed.form ?? error.message;
    }
    setIssues(routed);
  };

  const saved = (row: Announcement) => {
    onSaved?.(row);
    close();
  };

  const submit = () => {
    if (announcement) {
      const patch = announcementPatch(announcement, {
        title,
        body,
        pinned,
        coverUploadId,
      });

      // Nothing changed. Closing is the honest answer; posting `{}` would be a
      // 422 keyed `"_"` telling the user off for touching nothing.
      if (!patch) {
        close();
        return;
      }

      const parsed = updateAnnouncementSchema.safeParse(patch);
      if (!parsed.success) {
        failedLocally(parsed.error.issues);
        return;
      }

      setIssues({});
      update.mutate(
        { id: announcement.id, input: parsed.data },
        { onSuccess: saved, onError: failed },
      );
      return;
    }

    const parsed = createAnnouncementSchema.safeParse({
      title,
      body,
      pinned,
      // Omitted rather than sent as `null` when there is no cover. `null` is
      // accepted and silently ignored on create (`announcement.service.ts:83`
      // guards with a truthiness check), but sending a key that means "delete
      // the cover" on a row that has none states something untrue.
      ...(coverUploadId ? { coverUploadId } : {}),
    });
    if (!parsed.success) {
      failedLocally(parsed.error.issues);
      return;
    }

    setIssues({});
    create.mutate(parsed.data, { onSuccess: saved, onError: failed });
  };

  /** The same routing, for the mirror of the backend validator that runs here. */
  function failedLocally(
    zodIssues: { path: PropertyKey[]; message: string }[],
  ) {
    const next: Issues = {};
    for (const issue of zodIssues) {
      const key = String(issue.path[0] ?? FORM_LEVEL_ERROR_KEY);
      const slot = ISSUE_FOR_FIELD[key as keyof typeof ISSUE_FOR_FIELD];
      if (slot && !next[slot]) next[slot] = issue.message;
      else if (!slot) next.form = next.form ?? issue.message;
    }
    setIssues(next);
  }

  const error = (slot: keyof Issues) =>
    issues[slot] ? (
      <p role="alert" className="text-[12px] text-destructive-strong">
        {issues[slot]}
      </p>
    ) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        // Wider than the vendored `sm:max-w-sm`: this sheet holds a 5000-
        // character body and, for anyone who can upload, an image picker.
        className="w-full gap-0 overflow-y-auto sm:max-w-xl! data-[side=right]:sm:max-w-xl!"
      >
        <SheetHeader className="gap-1 p-6 pb-2">
          <SheetTitle className="font-serif text-2xl leading-tight">
            {mode === "edit" ? "Edit announcement" : "New announcement"}
          </SheetTitle>
          <SheetDescription className="text-[13px]">
            {/*
              Said plainly because the API gives no way to soften it: there is
              no draft state, no audience field and no scheduling — every notice
              is live to every member the moment it is saved (contract §2.5).
            */}
            Everyone in this business sees it as soon as you save. There is no
            draft.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 p-6 pt-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-title`} className="text-[13px]">
              Title
            </Label>
            <input
              id={`${uid}-title`}
              value={title}
              disabled={busy}
              maxLength={150}
              placeholder="Stock take this Saturday"
              onChange={(event) => {
                setTitle(event.target.value);
                setIssues({});
              }}
              aria-invalid={issues.title ? true : undefined}
              className={cn(CONTROL, "h-10 py-0")}
            />
            {error("title")}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-body`} className="text-[13px]">
              Announcement
            </Label>
            <textarea
              id={`${uid}-body`}
              rows={9}
              value={body}
              disabled={busy}
              maxLength={5000}
              placeholder="We close the counter at 15:00 on Saturday for the monthly stock take."
              onChange={(event) => {
                setBody(event.target.value);
                setIssues({});
              }}
              aria-invalid={issues.body ? true : undefined}
              className={cn(CONTROL, "min-h-[180px] resize-y")}
            />
            {/*
              A live count, because the limit is a hard 422 at 5000 and a person
              writing a long notice should learn that before they press Save.
              Mono so the number does not jitter as it changes width.
            */}
            <p className="text-right font-mono text-[11px] text-muted-3">
              {body.length} / 5000
            </p>
            {error("body")}
          </div>

          <label
            htmlFor={`${uid}-pinned`}
            className="flex items-start gap-2.5 rounded-[10px] border border-border bg-surface-2 px-3.5 py-3"
          >
            <input
              id={`${uid}-pinned`}
              type="checkbox"
              checked={pinned}
              disabled={busy}
              onChange={(event) => {
                setPinned(event.target.checked);
                setIssues({});
              }}
              className="mt-0.5 size-4 flex-none accent-primary"
            />
            <span className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1.5 font-medium text-[13px] text-foreground">
                <Pin className="size-3.5 text-primary" aria-hidden="true" />
                Pin to the top
              </span>
              {/*
                The behaviour, not the word. The sort runs before pagination and
                nothing unpins the previous notice, so a business that pins six
                has a first page that is mostly pins — worth saying at the
                control rather than discovering on the feed.
              */}
              <span className="text-[12px] text-muted-foreground">
                Pinned notices sit above everything else, and stay there until
                someone unpins them. Nothing is unpinned automatically.
              </span>
            </span>
          </label>
          {error("pinned")}

          {canUpload ? (
            <div className="flex flex-col gap-1.5">
              <Label className="text-[13px]">Cover image</Label>
              <ImagePicker
                purpose="announcement"
                // One cover, not a gallery: the API stores a single `cover`
                // object, so a second id would have nowhere to go.
                max={1}
                value={coverUploadId ? [coverUploadId] : []}
                onChange={(ids) => {
                  setCoverUploadId(ids[0] ?? null);
                  setIssues({});
                }}
                // Mandatory on an edit: the gallery lists UNATTACHED uploads,
                // and this announcement's cover is attached, so without this the
                // saved image would render as an empty placeholder tile.
                known={announcement?.cover ? [announcement.cover] : undefined}
                disabled={busy}
              />
              {mode === "edit" && announcement?.cover ? (
                <p className="text-[12px] text-muted-foreground">
                  Replacing or removing this cover deletes the image permanently
                  — there is no way to get it back.
                </p>
              ) : null}
              {error("cover")}
            </div>
          ) : null}

          {issues.form ? (
            <div className="rounded-[10px] border border-destructive/40 bg-destructive-soft px-3.5 py-3 text-[13px] text-destructive-strong">
              <p role="alert">{issues.form}</p>
            </div>
          ) : null}

          <div className="flex justify-end gap-2.5 pt-1">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={close}
              className="h-10 rounded-[10px] px-4 text-[13px]"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={submit}
              className="h-10 rounded-[10px] px-4 text-[13px]"
            >
              {busy
                ? "Saving…"
                : mode === "edit"
                  ? "Save changes"
                  : "Post announcement"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
