"use client";

import { useEffect, useId, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useUpdateProfile } from "@/features/account/hooks/use-account-mutations";
import { useSession } from "@/features/auth/hooks/use-session";
import { updateProfileSchema } from "@/features/auth/schemas/auth.schema";
import {
  AlertNote,
  CONTROL,
  Field,
  InfoNote,
  SettingsPanel,
  SuccessNote,
} from "@/features/settings/components/form-primitives";
import { fieldErrorsFor } from "@/lib/api/errors";

/** First letters of the name, for an avatar with no image behind it. */
const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

/**
 * The Profile tab of `/account` — artboard `2k`, right panel.
 *
 * **Two editable fields, and that is the whole allow-list.** `PATCH /users/me`
 * takes `name` and `image` and nothing else; `email`, `emailVerified`,
 * `status`, `platformRole`, `password` and every id are **stripped rather than
 * rejected** (`user.validation.ts:14-33`, proven
 * `user-profile.test.ts:68-92,207-236`), which is worse than a refusal because
 * a form that sent them would look like it worked.
 *
 * **There is no email change anywhere in this API.** It is deliberately absent
 * upstream because it needs a verification round trip that does not exist yet
 * (`user.validation.ts:16-22`). So the address is rendered as a read-only fact
 * with a line saying why, rather than as a disabled input that implies the
 * feature is merely switched off.
 *
 * **`image` is a free string with no URL validation** — max 500, and `""`
 * clears it. Unlike the organization logo, which was deliberately moved to an
 * upload-backed `logoUploadId` for exactly this reason, there is **no
 * upload-backed avatar endpoint**, so this has to be a URL the person supplies.
 * `type="url"` gets the right keyboard and the browser's own format check
 * without pretending the server will validate it.
 */
export function ProfileForm() {
  const session = useSession();
  const user = session.data?.user;

  if (!user) return null;

  // Keyed on the id so the seeded state below is rebuilt if a different person
  // signs in on the same tab.
  return <ProfileFields key={user.id} user={user} />;
}

function ProfileFields({
  user,
}: {
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image?: string;
  };
}) {
  const uid = useId();
  const mutation = useUpdateProfile();

  const [name, setName] = useState(user.name);
  const [image, setImage] = useState(user.image ?? "");
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const dirty = name !== user.name || image !== (user.image ?? "");

  useEffect(() => {
    if (dirty) setSaved(false);
  }, [dirty]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();

    const parsed = updateProfileSchema.safeParse({ name, image });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "form");
        next[field] ??= issue.message;
      }
      setIssues(next);
      return;
    }

    setIssues({});
    mutation.mutate(parsed.data, {
      onSuccess: () => setSaved(true),
      onError: (error) => {
        const fields = fieldErrorsFor(error);
        setIssues(
          Object.keys(fields).length > 0 ? fields : { form: error.message },
        );
      },
    });
  };

  const busy = mutation.isPending;

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <SettingsPanel>
        <div className="flex items-center gap-4">
          <Avatar className="size-16 flex-none">
            {image ? <AvatarImage src={image} alt="" /> : null}
            <AvatarFallback className="text-base">
              {initials(name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col gap-1">
            <p className="truncate font-medium text-foreground text-sm">
              {user.name}
            </p>
            <p className="truncate font-mono text-muted-foreground text-xs">
              {user.email}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3.5">
          <Field id={`${uid}-name`} label="Your name" error={issues.name}>
            {(props) => (
              <input
                {...props}
                value={name}
                disabled={busy}
                maxLength={120}
                autoComplete="name"
                onChange={(event) => setName(event.target.value)}
                className={CONTROL}
              />
            )}
          </Field>

          <Field
            id={`${uid}-image`}
            label="Avatar image URL"
            error={issues.image}
            hint="Leave empty to show your initials instead."
          >
            {(props) => (
              <input
                {...props}
                type="url"
                value={image}
                disabled={busy}
                maxLength={500}
                placeholder="https://…"
                autoComplete="off"
                onChange={(event) => setImage(event.target.value)}
                className={CONTROL}
              />
            )}
          </Field>
        </div>
      </SettingsPanel>

      <SettingsPanel title="Email address">
        <p className="font-mono text-foreground text-sm">{user.email}</p>
        <InfoNote>
          {user.emailVerified
            ? "Your address is confirmed. TradeOs has no way to change an email address yet — ask an owner to invite the new address instead."
            : "This address is not confirmed yet. Some actions, such as inviting a teammate, stay blocked until it is."}
        </InfoNote>
      </SettingsPanel>

      {issues.form ? <AlertNote>{issues.form}</AlertNote> : null}
      {saved ? <SuccessNote>Your profile is saved.</SuccessNote> : null}

      <div className="flex justify-end gap-2.5 border-border border-t pt-4">
        <Button
          type="button"
          variant="outline"
          disabled={busy || !dirty}
          onClick={() => {
            setName(user.name);
            setImage(user.image ?? "");
            setIssues({});
            setSaved(false);
            mutation.reset();
          }}
        >
          Discard
        </Button>
        <Button type="submit" disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
