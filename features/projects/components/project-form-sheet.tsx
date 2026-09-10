"use client";

import { cn } from "cn";
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
import { useCustomers } from "@/features/customers/hooks/use-customers";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import { ImagePicker } from "@/features/uploads/components/image-picker";
import {
  API_ERROR_CODE,
  type ApiError,
  fieldErrorsFor,
} from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { PERMISSIONS } from "@/lib/auth/permissions";
import {
  useCreateProject,
  useUpdateProject,
} from "../hooks/use-project-mutations";
import {
  createProjectSchema,
  dateInputToIso,
  FORM_LEVEL_ERROR_KEY,
  isoToDateInput,
  projectPatch,
  updateProjectSchema,
} from "../schemas/project.schema";
import { PROJECT_STATUSES, type Project, type ProjectStatus } from "../types";
import { projectStatusLabel } from "./project-status-badge";

const CONTROL =
  "w-full rounded-[10px] border border-border bg-background px-3 py-2 text-[14px] text-foreground transition-colors placeholder:text-muted-3 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20";

/** How many customers the picker lists. The endpoint's own ceiling is 100. */
const CUSTOMER_LIMIT = 100;

/** Every refusal this sheet can show, addressed to the control that can fix it. */
interface Issues {
  title?: string;
  description?: string;
  customerId?: string;
  status?: string;
  progress?: string;
  startDate?: string;
  dueDate?: string;
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
 * is what an empty `PATCH {}` comes back as, and without a row here the message
 * "At least one field must be provided" would be looked up against a control
 * called `_`, find nothing, and vanish.
 */
const ISSUE_FOR_FIELD = {
  title: "title",
  description: "description",
  customerId: "customerId",
  status: "status",
  progress: "progress",
  startDate: "startDate",
  dueDate: "dueDate",
  coverUploadId: "cover",
  [FORM_LEVEL_ERROR_KEY]: "form",
} as const satisfies Record<string, keyof Issues>;

export interface ProjectFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Omitted to create, supplied to edit. The whole row, not just an id: the
   * form needs `cover.uploadId` and `cover.thumbUrl` (the upload gallery only
   * lists *unattached* images, so a saved cover cannot be looked up there) and
   * `projectPatch` diffs against every field of it.
   */
  project?: Project;
  /** Called with the saved row. Create uses it to navigate to the new project. */
  onSaved?: (project: Project) => void;
}

/**
 * Start or edit a project — the form behind artboard `2l`'s "New project".
 *
 * **Create and edit are one sheet on purpose**, because they are one shape:
 * `POST` and `PATCH` take the same eight keys and answer the same row. What
 * differs is the *body-building rule*:
 *
 *   - **Create** sends everything. `status` and `progress` carry the feature's
 *     only two body defaults (`"planned"`, `0`), so a create body is legal with
 *     nothing but a title.
 *   - **Edit** sends only what changed, built by `projectPatch`. Two values
 *     there are real and must survive the diff: `progress: 0` (a reset) and
 *     `coverUploadId: null` (delete the image). A truthiness filter over the
 *     diff would drop exactly those.
 *   - **An edit that changed nothing is not sent at all.** `projectPatch`
 *     answers `null` and the sheet just closes, because `PATCH {}` is a
 *     deliberate 422 whose message arrives under the field key `"_"` — a
 *     mystery error on a form the user believes they left alone (contract trap
 *     5, live guard `projects.test.ts:276-287`).
 *
 * **Four fields are one-way doors and the form says so.** `description`,
 * `customerId`, `startDate` and `dueDate` are each a 422 when sent as `null`
 * (contract §1.3, verified against the real schema), so once a project has a
 * customer or a due date there is no way through this API to take it away
 * again. Emptying the control therefore does nothing rather than clearing the
 * value, and the help text under it says that rather than letting a user
 * discover it by saving and reloading. The single exception is `description`,
 * which can be blanked to `""` — and comes back as `""`, not `null`.
 *
 * **Publishing is not on this form.** `isPublished` is `.strict()`-rejected on
 * both bodies; the share card owns it.
 *
 * Nothing here is a toast: a refusal lands under the control that caused it
 * (brief §8.4), and the ones with no field — a 403 from a role that changed
 * mid-session, a dead network — get the panel above the buttons.
 */
export function ProjectFormSheet({
  open,
  onOpenChange,
  project,
  onSaved,
}: ProjectFormSheetProps) {
  const uid = useId();
  const mode = project ? "edit" : "create";

  const create = useCreateProject();
  const update = useUpdateProject();
  const canUpload = useCan(PERMISSIONS.UPLOADS_CREATE);
  const canSeeCustomers = useCan(PERMISSIONS.CUSTOMERS_VIEW);

  /*
   * The timezone decides what calendar day a picked date becomes. A form that
   * built the instant from the browser's zone would store 31 December for a
   * shop that picked 1 January, and the detail screen — which formats in the
   * business zone — would show it back wrong. See `dateInputToIso`.
   */
  const { timezone } = useOrganization();

  /*
   * Real customer names, not a field for pasting an id.
   *
   * `Project.customerId` is bare on every read (contract §1.5), so this is the
   * only place in the slice where a customer has a name — and it comes from a
   * different feature's endpoint, not from the project. Gated on
   * `customers:view` because a member without it gets a 403 from this list, and
   * the right response to that is no picker rather than an error panel over a
   * form about something else.
   *
   * `limit: 100` is the endpoint's own ceiling; a business with more active
   * customers than that cannot reach the rest from here. The API has no
   * customer filter on projects worth pairing with a search box, so rather than
   * build a combobox for an edge case the sheet says what it is showing.
   */
  const customers = useCustomers(
    canSeeCustomers ? { limit: CUSTOMER_LIMIT } : {},
  );

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("planned");
  const [progress, setProgress] = useState(0);
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [coverUploadId, setCoverUploadId] = useState<ObjectId | null>(null);
  const [issues, setIssues] = useState<Issues>({});

  /*
   * Reset when the sheet opens, keyed on the row it opened over.
   *
   * An effect rather than a `key` on the caller, because the caller renders one
   * sheet for both "New project" and "Edit this one" — remounting on every open
   * would also discard the mutation state that renders the pending label.
   * Depending on `project?.id` and not on the object means a background refetch
   * that replaces the row with an equal one does not wipe what the user has
   * typed.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the project's fields are this effect's output, not its input — depending on them would reset the form under the user on every background refetch
  useEffect(() => {
    if (!open) return;
    setTitle(project?.title ?? "");
    setDescription(project?.description ?? "");
    setCustomerId(project?.customerId ?? "");
    setStatus(project?.status ?? "planned");
    setProgress(project?.progress ?? 0);
    setStartDate(isoToDateInput(project?.startDate ?? null, timezone));
    setDueDate(isoToDateInput(project?.dueDate ?? null, timezone));
    setCoverUploadId(project?.cover?.uploadId ?? null);
    setIssues({});
  }, [open, project?.id, timezone]);

  const busy = create.isPending || update.isPending;

  const close = () => onOpenChange(false);

  /**
   * Route a failure to the control that can fix it.
   *
   * Branching on `code`, never on `message` (CLAUDE.md). The interesting case
   * is `NOT_FOUND`, which this form can receive for **three** different reasons
   * — an unknown customer (a 404 on a *create*, which is unusual and is why it
   * is handled first), an upload that has gone, or the project itself being
   * deleted while the sheet was open. They are told apart by what the form is
   * actually carrying, because the code alone cannot.
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
        if (customerId) {
          setIssues({
            customerId:
              "That customer is no longer available. Pick another one, or leave it unset.",
          });
          return;
        }
        setIssues(
          coverUploadId
            ? { cover: "That image is no longer available. Pick another one." }
            : {
                form: "This project no longer exists — someone deleted it while this was open.",
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

  const saved = (row: Project) => {
    onSaved?.(row);
    close();
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

  const submit = () => {
    // Both dates go through the business's zone and come back ending in `Z`.
    // An empty control yields `undefined`, which means "omit the key" — there
    // is no `null` to send, so an emptied date leaves the stored one alone.
    const start = dateInputToIso(startDate, timezone);
    const due = dateInputToIso(dueDate, timezone);

    if (project) {
      const patch = projectPatch(project, {
        title,
        description,
        customerId,
        status,
        progress,
        startDate: start,
        dueDate: due,
        coverUploadId,
      });

      // Nothing changed. Closing is the honest answer; posting `{}` would be a
      // 422 keyed `"_"` telling the user off for touching nothing.
      if (!patch) {
        close();
        return;
      }

      const parsed = updateProjectSchema.safeParse(patch);
      if (!parsed.success) {
        failedLocally(parsed.error.issues);
        return;
      }

      setIssues({});
      update.mutate(
        { id: project.id, input: parsed.data },
        { onSuccess: saved, onError: failed },
      );
      return;
    }

    const parsed = createProjectSchema.safeParse({
      title,
      status,
      progress,
      // Every optional key is omitted rather than sent empty. `description: ""`
      // is legal but writes an empty string where the row would otherwise hold
      // `null`; `customerId: ""` and a date of `""` are both 422s.
      ...(description.trim() ? { description } : {}),
      ...(customerId ? { customerId } : {}),
      ...(start ? { startDate: start } : {}),
      ...(due ? { dueDate: due } : {}),
      // `null` on create is accepted and silently ignored
      // (`project.service.ts:110` guards with a truthiness check), but sending
      // a key that means "delete the cover" on a row that has none states
      // something untrue.
      ...(coverUploadId ? { coverUploadId } : {}),
    });
    if (!parsed.success) {
      failedLocally(parsed.error.issues);
      return;
    }

    setIssues({});
    create.mutate(parsed.data, { onSuccess: saved, onError: failed });
  };

  const error = (slot: keyof Issues) =>
    issues[slot] ? (
      <p role="alert" className="text-[12px] text-destructive-strong">
        {issues[slot]}
      </p>
    ) : null;

  const customerRows = customers.data?.items ?? [];
  const customersTruncated = (customers.data?.meta.total ?? 0) > CUSTOMER_LIMIT;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        // Wider than the vendored `sm:max-w-sm`: this sheet holds a 5000-
        // character description, two dates and, for anyone who can upload, an
        // image picker.
        className="w-full gap-0 overflow-y-auto sm:max-w-xl! data-[side=right]:sm:max-w-xl!"
      >
        <SheetHeader className="gap-1 p-6 pb-2">
          <SheetTitle className="font-serif text-2xl leading-tight">
            {mode === "edit" ? "Edit project" : "New project"}
          </SheetTitle>
          <SheetDescription className="text-[13px]">
            {mode === "edit"
              ? "Only what you change is saved."
              : "Nothing is shared with a client until you publish it."}
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
              placeholder="Shopfront refit — Eastleigh"
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
            <Label htmlFor={`${uid}-description`} className="text-[13px]">
              Description
            </Label>
            <textarea
              id={`${uid}-description`}
              rows={5}
              value={description}
              disabled={busy}
              maxLength={5000}
              placeholder="New counter, shelving to the back wall, and a glazed display facing the street."
              onChange={(event) => {
                setDescription(event.target.value);
                setIssues({});
              }}
              aria-invalid={issues.description ? true : undefined}
              className={cn(CONTROL, "min-h-[120px] resize-y")}
            />
            <p className="text-right font-mono text-[11px] text-muted-3">
              {description.length} / 5000
            </p>
            {/*
              Said where it happens: the client reads this on the share page,
              and there is no separate "public summary" field to write instead.
            */}
            <p className="text-[12px] text-muted-foreground">
              The client sees this on the shared page.
            </p>
            {error("description")}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${uid}-status`} className="text-[13px]">
                Status
              </Label>
              <select
                id={`${uid}-status`}
                value={status}
                disabled={busy}
                onChange={(event) => {
                  setStatus(event.target.value as ProjectStatus);
                  setIssues({});
                }}
                className={cn(CONTROL, "h-10 py-0")}
              >
                {PROJECT_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {projectStatusLabel(value)}
                  </option>
                ))}
              </select>
              {error("status")}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${uid}-progress`} className="text-[13px]">
                Progress
              </Label>
              <div className="flex items-center gap-2.5">
                <input
                  id={`${uid}-progress`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  step={1}
                  value={progress}
                  disabled={busy}
                  onChange={(event) => {
                    // `Number("")` is 0, which would silently reset a project
                    // to zero the moment the field is cleared to retype it.
                    const raw = event.target.value;
                    setProgress(raw === "" ? 0 : Number(raw));
                    setIssues({});
                  }}
                  aria-invalid={issues.progress ? true : undefined}
                  className={cn(CONTROL, "h-10 py-0")}
                />
                <span className="font-mono text-[13px] text-muted-foreground">
                  %
                </span>
              </div>
              {/*
                `step={1}` is not enough: `.int()` on the server rejects 100.5
                with a 422, and a typed decimal is easy.
              */}
              <p className="text-[12px] text-muted-foreground">
                A whole number from 0 to 100.
              </p>
              {error("progress")}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${uid}-start`} className="text-[13px]">
                Start date
              </Label>
              <input
                id={`${uid}-start`}
                type="date"
                value={startDate}
                disabled={busy}
                onChange={(event) => {
                  setStartDate(event.target.value);
                  setIssues({});
                }}
                aria-invalid={issues.startDate ? true : undefined}
                className={cn(CONTROL, "h-10 py-0")}
              />
              {error("startDate")}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${uid}-due`} className="text-[13px]">
                Due date
              </Label>
              <input
                id={`${uid}-due`}
                type="date"
                value={dueDate}
                disabled={busy}
                onChange={(event) => {
                  setDueDate(event.target.value);
                  setIssues({});
                }}
                aria-invalid={issues.dueDate ? true : undefined}
                className={cn(CONTROL, "h-10 py-0")}
              />
              {error("dueDate")}
            </div>
          </div>

          {/*
            The one-way door, stated once for all four fields rather than under
            each. Shown only when editing, because on a create there is nothing
            yet to be unable to clear.
          */}
          {mode === "edit" ? (
            <p className="rounded-[10px] border border-border bg-surface-2 px-3.5 py-3 text-[12px] text-muted-foreground">
              Dates and the customer can be changed but not removed — clearing a
              field here leaves the saved value alone. A description can be
              emptied.
            </p>
          ) : null}

          {canSeeCustomers ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${uid}-customer`} className="text-[13px]">
                Customer
              </Label>
              <select
                id={`${uid}-customer`}
                value={customerId}
                disabled={busy || customers.isPending}
                onChange={(event) => {
                  setCustomerId(event.target.value);
                  setIssues({});
                }}
                aria-invalid={issues.customerId ? true : undefined}
                className={cn(CONTROL, "h-10 py-0")}
              >
                <option value="">No customer</option>
                {/*
                  An edit whose customer is not in the first 100 — or is
                  archived, which this list excludes by default — would
                  otherwise fall back to "No customer" and quietly try to
                  detach on save. It cannot detach (that is a 422), but the
                  select would still be lying about what is stored, so the id
                  gets its own option.
                */}
                {customerId &&
                !customerRows.some((row) => row.id === customerId) ? (
                  <option value={customerId}>
                    Current customer (not in this list)
                  </option>
                ) : null}
                {customerRows.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
              {customersTruncated ? (
                <p className="text-[12px] text-muted-foreground">
                  Showing the first {CUSTOMER_LIMIT} customers.
                </p>
              ) : null}
              {error("customerId")}
            </div>
          ) : null}

          {canUpload ? (
            <div className="flex flex-col gap-1.5">
              <Label className="text-[13px]">Cover image</Label>
              <ImagePicker
                // `"project"`, and it matters: an upload created with any other
                // purpose is a 409 `UPLOAD_PURPOSE_MISMATCH` on attach
                // (`project.service.ts:67`).
                purpose="project"
                // One cover, not a gallery: the API stores a single `cover`
                // object, so a second id would have nowhere to go.
                max={1}
                value={coverUploadId ? [coverUploadId] : []}
                onChange={(ids) => {
                  setCoverUploadId(ids[0] ?? null);
                  setIssues({});
                }}
                // Mandatory on an edit: the gallery lists UNATTACHED uploads,
                // and this project's cover is attached, so without this the
                // saved image would render as an empty placeholder tile.
                known={project?.cover ? [project.cover] : undefined}
                disabled={busy}
              />
              {mode === "edit" && project?.cover ? (
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
                  : "Create project"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
