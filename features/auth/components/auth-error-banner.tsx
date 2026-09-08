import { TriangleAlert } from "lucide-react";

/**
 * The soft danger banner artboard `1f` draws above the fields on a failed
 * sign-in — the whole-request failure, not a per-field one. A 422 belongs on
 * the fields themselves via `fieldErrorsFor`; this is for the 401, the 429 and
 * anything the form cannot attribute to an input.
 *
 * `role="alert"` so the message is announced when it replaces nothing, which is
 * the usual case: the banner mounts only after the request comes back.
 */
export function AuthErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-[10px] border border-destructive/40 bg-destructive/12 px-3.5 py-3"
    >
      <TriangleAlert
        aria-hidden="true"
        strokeWidth={1.75}
        className="mt-px size-4 shrink-0 text-destructive"
      />
      <p className="text-[13px]">{message}</p>
    </div>
  );
}
