"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * One row of step 3. Deliberately a local shape and not a slice type: nothing
 * is sent anywhere yet, so there is no wire format for this to mirror. When
 * `POST /members/invite` is wired, the request body is the authority and this
 * becomes its mirror — see the TODO in `onboarding-wizard.tsx`.
 */
export interface InviteRow {
  email: string;
  /** A seeded global role name. `Owner` is the caller and is not assignable. */
  role: "Manager" | "Seller";
}

/** The seeded roles a new owner can hand out (`Backend/src/lib/permissions.ts`). */
const ROLES: InviteRow["role"][] = ["Manager", "Seller"];

/** Three is the whole point: this is a nudge, not the Members screen. */
export const MAX_INVITE_ROWS = 3;

export const emptyInviteRow = (): InviteRow => ({ email: "", role: "Seller" });

export interface StepInviteProps {
  rows: InviteRow[];
  onChange: (rows: InviteRow[]) => void;
}

/**
 * Step 3 of onboarding: who else works here.
 *
 * Skippable, and — for now — inert. The rows are collected so the flow reads
 * as finished, but nothing is sent: `POST /members/invite` belongs to the
 * members slice, and it is gated on a verified email of its own. The wizard's
 * submit handler carries the note explaining what to do with these rows when
 * that lands.
 */
export function StepInvite({ rows, onChange }: StepInviteProps) {
  const update = (index: number, patch: Partial<InviteRow>) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  return (
    <div className="flex flex-col gap-4">
      {rows.map((row, index) => (
        <div
          className="flex items-end gap-2"
          // The rows are positional and have no id of their own; a row's
          // identity IS its position, so the index is the honest key here.
          // biome-ignore lint/suspicious/noArrayIndexKey: positional rows with no stable id
          key={index}
        >
          <div className="flex flex-1 flex-col gap-[7px]">
            <Label
              className="text-[13px]"
              htmlFor={`onboarding-invite-email-${index}`}
            >
              {index === 0 ? "Email" : `Email ${index + 1}`}
            </Label>
            <Input
              className="h-11 rounded-[10px] bg-card"
              id={`onboarding-invite-email-${index}`}
              onChange={(event) => update(index, { email: event.target.value })}
              placeholder="yusuf@sparktrading.co.ke"
              type="email"
              value={row.email}
            />
          </div>

          <div className="flex w-[124px] flex-col gap-[7px]">
            <Label
              className="text-[13px]"
              htmlFor={`onboarding-invite-role-${index}`}
            >
              Role
            </Label>
            <select
              className="h-11 w-full rounded-[10px] border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              id={`onboarding-invite-role-${index}`}
              onChange={(event) =>
                update(index, { role: event.target.value as InviteRow["role"] })
              }
              value={row.role}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </div>

          {rows.length > 1 ? (
            <Button
              aria-label={`Remove teammate ${index + 1}`}
              className="size-11 rounded-[10px]"
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
              size="icon"
              type="button"
              variant="ghost"
            >
              <X />
            </Button>
          ) : null}
        </div>
      ))}

      {rows.length < MAX_INVITE_ROWS ? (
        <Button
          className="h-9 self-start rounded-[10px]"
          onClick={() => onChange([...rows, emptyInviteRow()])}
          type="button"
          variant="outline"
        >
          <Plus />
          Add another
        </Button>
      ) : null}
    </div>
  );
}
