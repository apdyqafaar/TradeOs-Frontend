/**
 * The browser half of the passkey ceremony, on the raw WebAuthn API.
 *
 * ## Why not `@simplewebauthn/browser`
 *
 * The API's contract says its options are drop-in for that library, and they
 * are — but `package.json` does not carry it (checked: the dependency list has
 * no `@simplewebauthn/*` entry), and adding a dependency to this repo is the
 * owner's call rather than a settings screen's (see
 * `docs/findings/no-churn-on-working-deps.md`). The platform API does the same
 * job here in about eighty lines, because modern browsers ship the JSON
 * conversion themselves.
 *
 * ## The two conversions, and the trap in the second one
 *
 * The server speaks `PublicKeyCredentialCreationOptionsJSON`, where
 * `challenge`, `user.id` and every credential id are **base64url** strings; the
 * browser wants `ArrayBuffer`s. `PublicKeyCredential.parseCreationOptionsFromJSON`
 * does that conversion natively and is used whenever it exists, precisely
 * because it also handles fields this file has never heard of — the WebAuthn
 * options object grows, and a hand-written converter silently drops whatever it
 * was not taught.
 *
 * On the way back, `credential.toJSON()` produces the exact envelope the API's
 * `passkeyRegisterVerifySchema` validates. The hand-written fallback has to
 * encode as **base64url, not base64**: the API's validator is
 * `/^[A-Za-z0-9_-]*$/` and any `+`, `/` or `=` is a **422**
 * (`passkey.validation.ts:16-20`, contract §3.5). Standard `btoa` output fails
 * every time, which is exactly the bug that is invisible until a real device is
 * in front of you.
 */

/** Base64url, no padding — the only encoding the API's validators accept. */
const toBase64Url = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

const fromBase64Url = (value: string): ArrayBuffer => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
};

/**
 * Whether this browser can do passkeys at all.
 *
 * Checked before the button is rendered, not after it is pressed: a control
 * that is always there and always fails is worse than one that is absent on the
 * handful of browsers without WebAuthn.
 */
export const isPasskeySupported = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.PublicKeyCredential === "function" &&
  typeof navigator.credentials?.create === "function";

/** The raw JSON the server sent, passed through with as little handling as possible. */
export type CreationOptionsJson = Record<string, unknown>;

/**
 * `toJSON` and `parseCreationOptionsFromJSON` are declared as required by this
 * TypeScript's DOM lib but are genuinely absent on older browsers, so both are
 * probed with `typeof` at runtime and typed as optional here. Trusting the lib
 * definition would mean calling `undefined` on exactly the browsers the manual
 * fallbacks below exist for.
 */
type OptionalJson<T> = Omit<T, "toJSON"> & { toJSON?: () => unknown };

interface JsonCapableStatic {
  parseCreationOptionsFromJSON?: (
    json: CreationOptionsJson,
  ) => PublicKeyCredentialCreationOptions;
}

/**
 * Hand-convert the fields that are base64url in the JSON form.
 *
 * Only reached on a browser without `parseCreationOptionsFromJSON` (pre-2023
 * Safari and Firefox). Everything it does not name is passed through
 * untouched, which is the right default: `authenticatorSelection`, `timeout`,
 * `attestation` and `pubKeyCredParams` are already the shapes the browser
 * wants.
 */
const parseOptionsManually = (
  json: CreationOptionsJson,
): PublicKeyCredentialCreationOptions => {
  const options = { ...json } as Record<string, unknown>;

  if (typeof options.challenge === "string") {
    options.challenge = fromBase64Url(options.challenge);
  }

  const user = options.user as { id?: unknown } | undefined;
  if (user && typeof user.id === "string") {
    options.user = { ...user, id: fromBase64Url(user.id) };
  }

  const exclude = options.excludeCredentials;
  if (Array.isArray(exclude)) {
    options.excludeCredentials = exclude.map((entry) => {
      const credential = entry as { id?: unknown };
      return typeof credential.id === "string"
        ? { ...credential, id: fromBase64Url(credential.id) }
        : credential;
    });
  }

  return options as unknown as PublicKeyCredentialCreationOptions;
};

/** The mirror of the above, for a credential whose `toJSON` is missing. */
const credentialToJsonManually = (
  credential: PublicKeyCredential,
): Record<string, unknown> => {
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? null,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      attestationObject: toBase64Url(response.attestationObject),
      // `getTransports` is not on every implementation, and the field is
      // optional upstream — an absent one is fine, a thrown one is not.
      transports:
        typeof response.getTransports === "function"
          ? response.getTransports()
          : undefined,
    },
  };
};

/**
 * Turn the server's options into a credential, ready to post as `response`.
 *
 * Throws a `PasskeyCeremonyError` whose message is written for a person. The
 * DOM exception names are the only reliable way to tell these apart —
 * `error.message` is browser-specific and often empty.
 */
export class PasskeyCeremonyError extends Error {
  /** True when the person simply changed their mind, which is not a failure. */
  readonly cancelled: boolean;

  constructor(message: string, cancelled = false) {
    super(message);
    this.name = "PasskeyCeremonyError";
    this.cancelled = cancelled;
  }
}

export async function createPasskeyCredential(
  optionsJson: CreationOptionsJson,
): Promise<Record<string, unknown>> {
  if (!isPasskeySupported()) {
    throw new PasskeyCeremonyError(
      "This browser cannot create passkeys. Try a current Chrome, Safari, Edge or Firefox.",
    );
  }

  const statics = window.PublicKeyCredential as unknown as JsonCapableStatic;
  const publicKey =
    typeof statics.parseCreationOptionsFromJSON === "function"
      ? statics.parseCreationOptionsFromJSON(optionsJson)
      : parseOptionsManually(optionsJson);

  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.create({
      publicKey,
    })) as PublicKeyCredential | null;
  } catch (error) {
    throw toCeremonyError(error);
  }

  if (!credential) {
    throw new PasskeyCeremonyError("No passkey was created.", true);
  }

  const maybeJson = credential as OptionalJson<PublicKeyCredential>;
  return typeof maybeJson.toJSON === "function"
    ? (maybeJson.toJSON() as Record<string, unknown>)
    : credentialToJsonManually(credential);
}

const toCeremonyError = (error: unknown): PasskeyCeremonyError => {
  const name = error instanceof DOMException ? error.name : "";

  switch (name) {
    case "NotAllowedError":
      // Cancelled, or timed out at sixty seconds. The spec deliberately makes
      // these indistinguishable so a page cannot tell whether a user has a
      // credential — so the copy has to cover both without guessing.
      return new PasskeyCeremonyError(
        "No passkey was created — the prompt was dismissed or timed out.",
        true,
      );
    case "InvalidStateError":
      // The server sends `excludeCredentials`, so re-registering the same
      // authenticator is refused by the *browser*, not by the API — which
      // means there is no request to show an error from.
      return new PasskeyCeremonyError(
        "That device already has a passkey for this account.",
      );
    case "SecurityError":
      return new PasskeyCeremonyError(
        "This page's address does not match the one passkeys were set up for.",
      );
    case "NotSupportedError":
      return new PasskeyCeremonyError(
        "This device cannot create a passkey of the kind TradeOs asks for.",
      );
    default:
      return new PasskeyCeremonyError(
        "Your device could not complete the passkey step. Try again.",
      );
  }
};
