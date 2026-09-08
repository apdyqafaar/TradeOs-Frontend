import type {
  AcceptInviteInput,
  ChangePasswordInput,
  DeleteAccountInput,
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  TwoFactorChallengeInput,
  TwoFactorDisableInput,
  TwoFactorVerifyInput,
  UpdateProfileInput,
  VerifyEmailInput,
} from "@/features/auth/schemas/auth.schema";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api/client";

/**
 * One function per `/auth/*` and `/users/me` endpoint.
 *
 * No React here: these are called from hooks, from route handlers and from
 * tests, and a `useQuery` import would make the last two impossible. Return
 * types mirror `Backend/src/controller/auth.controller.ts`,
 * `two-factor.controller.ts`, `passkey.controller.ts` and `user.controller.ts`
 * field for field.
 */

/** `publicUser` in `auth.controller.ts` — the same five fields everywhere. */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string;
}

/**
 * `GET /auth/me`. `organization` and `role` are `null` for a signed-in user
 * who has not created or joined a business yet — a normal, supported state,
 * and how the app decides to show the create-business screen.
 */
export interface SessionData {
  user: SessionUser;
  organization: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
  } | null;
  role: { id: string; name: string } | null;
  /** May contain `"*"` (the Owner preset) or a permission this build predates. */
  permissions: string[];
  twoFactorEnabled: boolean;
}

/**
 * `POST /auth/login` has two outcomes and they are not the same event.
 *
 * A plain login sets the session cookie and returns the user. An account with
 * a second factor gets NO cookie at all — the handler returns before
 * `setSessionCookie` and deliberately omits the user object, because a correct
 * password alone proves nothing more than that. `challengeToken` is not a
 * session and `requireAuth` will not accept it; only
 * `POST /auth/2fa/challenge` trades it for one.
 */
export type LoginResult =
  | { twoFactorRequired: false; user: SessionUser }
  | { twoFactorRequired: true; challengeToken: string; expiresAt: string };

export interface DeviceSession {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  /** The device the user is reading this list on. */
  isCurrent: boolean;
}

export interface Passkey {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt?: string | null;
}

/**
 * WebAuthn ceremony options, passed to `@simplewebauthn/browser` verbatim.
 * Left opaque on purpose: the shape is the WebAuthn spec's, it grows with
 * browser versions, and nothing in this app reads a field off it.
 */
export type WebAuthnOptions = Record<string, unknown>;
/** The credential the browser produced, forwarded to the API unmodified. */
export type WebAuthnCredential = Record<string, unknown>;

export const login = (input: LoginInput): Promise<LoginResult> =>
  apiPost<LoginResult>("/auth/login", input);

export const register = (
  input: RegisterInput,
): Promise<{ user: SessionUser }> =>
  apiPost<{ user: SessionUser }>("/auth/register", input);

export const logout = (): Promise<void> => apiPost<void>("/auth/logout");

export const logoutAll = (): Promise<void> => apiPost<void>("/auth/logout-all");

export const getSession = (): Promise<SessionData> =>
  apiGet<SessionData>("/auth/me");

export const acceptInvite = (
  input: AcceptInviteInput,
): Promise<{ user: SessionUser }> =>
  apiPost<{ user: SessionUser }>("/auth/accept-invite", input);

/** Always succeeds, whether or not the address has an account. */
export const forgotPassword = (input: ForgotPasswordInput): Promise<void> =>
  apiPost<void>("/auth/forgot-password", input);

/** Revokes every session, this one included. The user signs in again after. */
export const resetPassword = (input: ResetPasswordInput): Promise<void> =>
  apiPost<void>("/auth/reset-password", input);

export const verifyEmail = (input: VerifyEmailInput): Promise<void> =>
  apiPost<void>("/auth/verify-email", input);

export const resendVerification = (): Promise<void> =>
  apiPost<void>("/auth/resend-verification");

export const listDeviceSessions = (): Promise<{ sessions: DeviceSession[] }> =>
  apiGet<{ sessions: DeviceSession[] }>("/auth/sessions");

export const logoutOthers = (): Promise<{ revokedSessions: number }> =>
  apiPost<{ revokedSessions: number }>("/auth/logout-others");

/** Keeps the caller's own session alive; the count is of the others it revoked. */
export const changePassword = (
  input: ChangePasswordInput,
): Promise<{ revokedSessions: number }> =>
  apiPost<{ revokedSessions: number }>("/auth/change-password", input);

/** A DELETE with a body: the current password is a credential and must not sit in a URL. */
export const deleteAccount = (input: DeleteAccountInput): Promise<void> =>
  apiDelete<void>("/auth/account", { data: input });

/** The only response that ever contains the secret. Never log or cache it. */
export const setupTwoFactor = (): Promise<{
  otpauthUri: string;
  secret: string;
}> => apiPost<{ otpauthUri: string; secret: string }>("/auth/2fa/setup");

/** Recovery codes come back once, here; they are stored hashed and cannot be shown again. */
export const verifyTwoFactor = (
  input: TwoFactorVerifyInput,
): Promise<{ recoveryCodes: string[] }> =>
  apiPost<{ recoveryCodes: string[] }>("/auth/2fa/verify", input);

export const disableTwoFactor = (input: TwoFactorDisableInput): Promise<void> =>
  apiPost<void>("/auth/2fa/disable", input);

/** Step two of login: trades the challenge token for the session cookie. */
export const twoFactorChallenge = (
  input: TwoFactorChallengeInput,
): Promise<{ user: SessionUser }> =>
  apiPost<{ user: SessionUser }>("/auth/2fa/challenge", input);

export const passkeyRegisterOptions = (): Promise<{
  options: WebAuthnOptions;
}> => apiPost<{ options: WebAuthnOptions }>("/auth/passkeys/register/options");

export const passkeyRegisterVerify = (input: {
  label: string;
  response: WebAuthnCredential;
}): Promise<{ passkey: Passkey }> =>
  apiPost<{ passkey: Passkey }>("/auth/passkeys/register/verify", input);

export const passkeyLoginOptions = (): Promise<{ options: WebAuthnOptions }> =>
  apiPost<{ options: WebAuthnOptions }>("/auth/passkeys/login/options");

export const passkeyLoginVerify = (input: {
  response: WebAuthnCredential;
}): Promise<{ user: SessionUser }> =>
  apiPost<{ user: SessionUser }>("/auth/passkeys/login/verify", input);

export const listPasskeys = (): Promise<{ passkeys: Passkey[] }> =>
  apiGet<{ passkeys: Passkey[] }>("/auth/passkeys");

export const deletePasskey = (id: string): Promise<void> =>
  apiDelete<void>(`/auth/passkeys/${id}`);

/** `PATCH /users/me` returns the profile itself, not a `{ user }` wrapper. */
export const updateProfile = (
  input: UpdateProfileInput,
): Promise<SessionUser> => apiPatch<SessionUser>("/users/me", input);
