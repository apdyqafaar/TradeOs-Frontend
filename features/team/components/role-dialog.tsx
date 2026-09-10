"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { type ApiError, fieldErrorsFor } from "@/lib/api/errors";
import { ALL_PERMISSIONS } from "@/lib/auth/permissions";
import { useCreateRole, useUpdateRole } from "../hooks/use-role-mutations";
import {
  createRoleSchema,
  permissionSet,
  updateRoleSchema,
} from "../schemas/role.schema";
import type { Role } from "../types";
import { PermissionMatrix } from "./permission-matrix";

const CONTROL =
  "w-full rounded-[10px] border border-border bg-background px-3 py-2.5 text-sm text-foreground leading-relaxed transition-colors focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20";

const PANEL =
  "rounded-[10px] border border-destructive/30 bg-destructive-soft px-3.5 py-2.5 text-[13px] text-destructive-strong";

/**
 * Create or edit a custom role — the right-hand panel of artboard `2j`
 * (`docs/design/TradeOs-UI.dc.html:1289-1319`), as a dialog.
 *
 * ## The three body rules that bite
 *
 * 1. **`permissions` is required on create.** The model defaults it to `[]`,
 *    the validator does not — omitting the key is a 422 reading "expected
 *    array, received undefined". A role with no permissions is legal and is
 *    sent as an explicit `[]`.
 * 2. **The array is not de-duplicated server-side and is capped at 43.** The
 *    matrix holds a `Set` and `permissionSet` re-orders it into catalog order
 *    on the way out, so two people ticking the same boxes in a different order
 *    send byte-identical bodies and nobody can click their way past the cap.
 * 3. **PATCH is a true partial update**, and this dialog sends only what
 *    changed. It is not an optimisation — sending an unchanged `permissions`
 *    array is harmless, but sending an unchanged `name` is not: the reserved
 *    name check runs on every submitted name, so a role that somehow held a
 *    reserved name would become uneditable. Diffing keeps a PATCH to the fields
 *    the user actually touched.
 *
 * ## Two 409s that do not look alike
 *
 * A **reserved name** (`owner`/`manager`/`seller`, any casing, after trimming)
 * is a service check and arrives with `code: "CONFLICT"` and a message. A
 * **duplicate custom name** has no service check at all — it hits the
 * `(organizationId, name)` unique index and comes back as
 * `{ message: "Resource already exists", errors: { name: … } }` with **no
 * `code` key** (`error.middleware.ts:105-110`). Reading only `code` would show
 * nothing at all for the second, so both paths land on the name field.
 *
 * The reserved names are also refused client-side by `createRoleSchema`, so the
 * common case never spends a request; the server check stays as the authority.
 */
export interface RoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omit to create. Pass a role to edit — presets must never be passed. */
  role?: Role;
}

export function RoleDialog({ open, onOpenChange, role }: RoleDialogProps) {
  const uid = useId();
  const create = useCreateRole();
  const update = useUpdateRole();
  const editing = role !== undefined;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [granted, setGranted] = useState<Set<string>>(new Set());
  const [issues, setIssues] = useState<{
    name?: string;
    description?: string;
    permissions?: string;
    form?: string;
  }>({});

  // Seeded on the way in, never on the way out: resetting on close would empty
  // the form under the closing animation. `role?.id` is in the deps so opening
  // the dialog on a different role re-seeds rather than showing the last one.
  //
  // biome-ignore lint/correctness/useExhaustiveDependencies: the role's fields are this effect's output, not its input — `permissions` is a fresh array on every refetch, so depending on it would wipe a half-ticked matrix under the user the moment the roles query revalidated. Identity (`role?.id`) is the only input that should re-seed.
  useEffect(() => {
    if (!open) return;
    setName(role?.name ?? "");
    setDescription(role?.description ?? "");
    // Filtered through the catalog: a permission the backend has added but this
    // build's mirror has not heard of would otherwise be an invisible entry in
    // the set that gets silently re-sent — or silently dropped, depending on
    // which way the diff fell. Dropping it is the safe direction and it is
    // visible, because the matrix shows exactly what will be saved.
    const known = new Set<string>(ALL_PERMISSIONS);
    setGranted(new Set((role?.permissions ?? []).filter((p) => known.has(p))));
    setIssues({});
  }, [open, role?.id]);

  const mutation = editing ? update : create;

  const failed = (error: ApiError) => {
    const fields = fieldErrorsFor(error);

    // `errors.name` covers both the 422 (too long, empty) and the index-driven
    // duplicate 409, which carries no `code` at all.
    if (fields.name || fields.description) {
      setIssues({ name: fields.name, description: fields.description });
      return;
    }

    // The permission validator files its issue under `permissions` or
    // `permissions.<index>`; either way it belongs beside the matrix.
    const permissionIssue = Object.entries(fields).find(([field]) =>
      field.startsWith("permissions"),
    );
    if (permissionIssue) {
      setIssues({ permissions: permissionIssue[1] });
      return;
    }

    // The empty-PATCH 422 is filed under `_`, not a field name — it cannot
    // reach an input, so it goes in the banner. The client schema refuses that
    // case first, so this is a backstop.
    if (fields._) {
      setIssues({ form: fields._ });
      return;
    }

    // A reserved-name 409 and the built-in 403 both arrive as a sentence
    // written for a person. The reserved one is about the name, so it goes
    // there; anything else is about the whole attempt.
    if (error.status === 409) {
      setIssues({ name: error.message });
      return;
    }

    setIssues({ form: error.message });
  };

  const submit = () => {
    // De-duplicated and put back into catalog order. The Set already prevents
    // duplicates; this makes the wire body deterministic as well.
    const permissions = permissionSet(granted);

    if (!editing) {
      const parsed = createRoleSchema.safeParse({
        name,
        // An omitted key, not an empty string: `description` has no `min(1)` on
        // either side, so `""` would be stored as an empty description rather
        // than as no description.
        description: description.trim() === "" ? undefined : description,
        permissions,
      });
      if (!parsed.success) {
        setIssues(collect(parsed.error.issues));
        return;
      }
      setIssues({});
      create.mutate(parsed.data, {
        onSuccess: () => onOpenChange(false),
        onError: failed,
      });
      return;
    }

    // Only what changed. See rule 3 above.
    const patch: Record<string, unknown> = {};
    if (name.trim() !== role.name) patch.name = name;
    if (description.trim() !== (role.description ?? "")) {
      patch.description = description;
    }
    if (!sameSet(permissions, role.permissions))
      patch.permissions = permissions;

    const parsed = updateRoleSchema.safeParse(patch);
    if (!parsed.success) {
      setIssues(collect(parsed.error.issues));
      return;
    }

    setIssues({});
    update.mutate(
      { roleId: role.id, input: parsed.data },
      { onSuccess: () => onOpenChange(false), onError: failed },
    );
  };

  const busy = mutation.isPending;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 supports-backdrop-filter:backdrop-blur-xs data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-[560px] flex-col gap-4 overflow-y-auto rounded-[14px] border border-border bg-popover p-6 text-popover-foreground shadow-[0_12px_32px_rgba(31,30,29,0.14)] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <Dialog.Title className="font-serif text-2xl leading-tight text-foreground">
            {editing ? `Edit ${role.name}` : "New role"}
          </Dialog.Title>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-name`}>Name</Label>
            <input
              id={`${uid}-name`}
              value={name}
              disabled={busy}
              maxLength={60}
              placeholder="Stock clerk"
              aria-invalid={issues.name ? true : undefined}
              aria-describedby={issues.name ? `${uid}-name-error` : undefined}
              onChange={(event) => setName(event.target.value)}
              className={CONTROL}
            />
            {issues.name ? (
              <p
                id={`${uid}-name-error`}
                className="text-[13px] text-destructive"
              >
                {issues.name}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-description`}>
              Description{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <input
              id={`${uid}-description`}
              value={description}
              disabled={busy}
              maxLength={200}
              placeholder="Restocks and adjusts, cannot sell"
              aria-invalid={issues.description ? true : undefined}
              onChange={(event) => setDescription(event.target.value)}
              className={CONTROL}
            />
            {issues.description ? (
              <p className="text-[13px] text-destructive">
                {issues.description}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="font-medium text-[13px] text-foreground">
              What this role can do
            </p>
            <PermissionMatrix value={granted} onChange={setGranted} />
            {issues.permissions ? (
              <p role="alert" className="text-[13px] text-destructive">
                {issues.permissions}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {granted.size} of {ALL_PERMISSIONS.length} selected. A role with
                nothing ticked can sign in and see nothing — that is allowed.
              </p>
            )}
          </div>

          {issues.form ? (
            <p role="alert" className={PANEL}>
              {issues.form}
            </p>
          ) : null}

          <div className="flex justify-end gap-2.5">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button disabled={busy} onClick={submit}>
              {editing ? "Save changes" : "Create role"}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Order-insensitive comparison, because the wire order is not meaningful. */
const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) return false;
  const other = new Set(b);
  return a.every((entry) => other.has(entry));
};

/**
 * First issue per field. Zod reports every failure; a form shows one per input,
 * and the first is the one the person can act on.
 */
const collect = (
  issues: readonly { path: PropertyKey[]; message: string }[],
): {
  name?: string;
  description?: string;
  permissions?: string;
  form?: string;
} => {
  const next: {
    name?: string;
    description?: string;
    permissions?: string;
    form?: string;
  } = {};

  for (const issue of issues) {
    const field = issue.path[0];
    if (field === "name") next.name ??= issue.message;
    else if (field === "description") next.description ??= issue.message;
    else if (field === "permissions") next.permissions ??= issue.message;
    // A refine on the object itself has an empty path — the "change something
    // first" case, which belongs in the banner.
    else next.form ??= issue.message;
  }

  return next;
};
