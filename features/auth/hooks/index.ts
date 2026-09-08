/**
 * Convenience barrel. Importing the individual modules is equally supported
 * and preferred inside `features/auth` itself, so a hook never has to pull the
 * whole feature's graph in to reach its neighbour.
 */

export type { LoginResult } from "./use-login";
export { useLogin } from "./use-login";
export { useLogout } from "./use-logout";
export { useCan, usePermissions } from "./use-permission";
export { useRegister } from "./use-register";
export type { SessionData, SessionUser } from "./use-session";
export { useSession } from "./use-session";
