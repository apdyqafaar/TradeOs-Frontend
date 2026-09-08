import { z } from "zod";

/**
 * Mirrors of the API's zod schemas, so a form rejects what the API would
 * reject before spending a round trip on it.
 *
 * Every rule below is copied from `Backend/src/validators/auth.validation.ts`,
 * `two-factor.validation.ts` and `user.validation.ts` — same bounds, same
 * messages. These are a convenience, never the authority: the API validates
 * again and answers a 422 with `errors: { field: message }`, which
 * `fieldErrorsFor` feeds straight into react-hook-form's `setError`. When the
 * two disagree, the API wins and this file is the thing that is wrong.
 */

/** Backend: shared `password` rule, 8..128. Login deliberately does not use it. */
const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters");

/** Backend: `z.string().trim().min(1).max(120)`. */
const personName = z.string().trim().min(1, "Your name is required").max(120);

export const loginSchema = z.object({
  email: z.email("Enter a valid email address").toLowerCase(),
  // Length is NOT checked here on purpose: the API checks the typed password
  // against what is stored, not against today's policy, so an account created
  // under an older rule must still be able to sign in.
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  name: personName,
  email: z.email("Enter a valid email address").toLowerCase().max(254),
  password,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const forgotPasswordSchema = z.object({
  email: z.email("Enter a valid email address").toLowerCase().max(254),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  password,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Your current password is required"),
  newPassword: password,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().min(1, "Invitation token is required"),
  name: personName,
  password,
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().min(1, "Verification token is required"),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const deleteAccountSchema = z.object({
  currentPassword: z.string().min(1, "Your current password is required"),
});
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;

/**
 * Step two of login. `code` is bounded, not shape-checked: it is either a
 * six-digit TOTP or a recovery code, and a validator that rejected everything
 * but those two exact shapes would tell a caller in a 422 that they had
 * guessed the recovery-code format right.
 */
export const twoFactorChallengeSchema = z.object({
  challengeToken: z.string().min(1, "Sign in again to get a new code prompt"),
  code: z
    .string()
    .trim()
    .min(1, "A verification code is required")
    .max(64, "That is not a valid verification code"),
});
export type TwoFactorChallengeInput = z.infer<typeof twoFactorChallengeSchema>;

/** `POST /auth/2fa/verify` — confirming a new secret takes a TOTP and nothing else. */
export const twoFactorVerifySchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app"),
});
export type TwoFactorVerifyInput = z.infer<typeof twoFactorVerifySchema>;

/** Turning the second factor off takes the password AND a code; either alone is not enough. */
export const twoFactorDisableSchema = z.object({
  currentPassword: z.string().min(1, "Your current password is required"),
  code: z
    .string()
    .trim()
    .min(1, "A verification code is required")
    .max(64, "That is not a valid verification code"),
});
export type TwoFactorDisableInput = z.infer<typeof twoFactorDisableSchema>;

/**
 * `PATCH /users/me`. The API's allow-list is exactly these two fields — email,
 * status, `emailVerified` and `platformRole` are deliberately not editable
 * here — and it refuses an empty body with "Provide at least one field".
 */
export const updateProfileSchema = z
  .object({
    name: personName.optional(),
    // An empty string clears the avatar.
    image: z.string().trim().max(500).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update",
  });
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
