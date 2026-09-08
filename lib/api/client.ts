import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";
import { toast } from "sonner";
import { env } from "@/config/env";
import { API_ERROR_CODE, ApiError, isApiError } from "@/lib/api/errors";
import type { ApiEnvelope, PageMeta, Paginated } from "@/lib/api/types";
import { getQueryClient } from "@/lib/query/client";

/**
 * The one axios instance the whole app talks through.
 *
 * `withCredentials` is the entire auth story. The API issues an httpOnly,
 * SameSite session cookie (`Backend/README.md`, "Auth model"), the browser
 * attaches it, and JavaScript cannot read it. **Do not add a request
 * interceptor that attaches an Authorization header** — there is no token in
 * reach to attach, and code that pretends otherwise ends up inventing a
 * localStorage token store, which is exactly the XSS-exfiltratable thing the
 * cookie design avoids. The future mobile client is the only Bearer caller.
 */
export const api: AxiosInstance = axios.create({
  baseURL: env.apiBaseUrl,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
  // Long enough for a product import commit (one transaction over up to 2,000
  // rows), short enough that a dead connection surfaces as an error the user
  // can act on rather than a spinner that never resolves.
  timeout: 30_000,
});

/**
 * `meta` rides on the *response object*, not on the unwrapped payload.
 *
 * The response interceptor replaces `response.data` with `envelope.data`, so
 * the pagination `meta` that sat beside it in the envelope would be lost. It
 * is lifted onto the AxiosResponse itself instead of being merged into the
 * payload: the payload is a plain `T[]` that callers map, sort and spread, and
 * a smuggled extra property on it would leak into component props and JSON.
 * `apiGet` reads `.data` and stays oblivious; only `apiGetList` reads `.meta`.
 */
interface UnwrappedResponse<T> extends AxiosResponse<T> {
  meta?: PageMeta;
}

const isEnvelope = (body: unknown): body is ApiEnvelope<unknown> =>
  typeof body === "object" && body !== null && "success" in body;

/**
 * Every response echoes the correlation id; the error card prints it because
 * support asks for it. Header names are case-insensitive, and `AxiosHeaders`
 * stores a header under whatever casing it was first set with — so ask its
 * accessor, which normalises, before falling back to a scan.
 */
const readRequestId = (
  response: AxiosResponse | undefined,
): string | undefined => {
  const headers: unknown = response?.headers;
  if (typeof headers !== "object" || headers === null) return undefined;

  const getter = (headers as { get?: (name: string) => unknown }).get;
  if (typeof getter === "function") {
    const value = getter.call(headers, "x-request-id");
    if (typeof value === "string") return value;
  }

  for (const [name, value] of Object.entries(
    headers as Record<string, unknown>,
  )) {
    if (name.toLowerCase() === "x-request-id" && typeof value === "string")
      return value;
  }
  return undefined;
};

/** The `code` to assume when a failure body carried none (a proxy 502, an HTML 404). */
const codeForStatus = (status: number): string => {
  switch (status) {
    case 400:
      return API_ERROR_CODE.BAD_REQUEST;
    case 401:
      return API_ERROR_CODE.UNAUTHORIZED;
    case 403:
      return API_ERROR_CODE.FORBIDDEN;
    case 404:
      return API_ERROR_CODE.NOT_FOUND;
    case 409:
      return API_ERROR_CODE.CONFLICT;
    case 413:
      return API_ERROR_CODE.FILE_TOO_LARGE;
    case 422:
      return API_ERROR_CODE.VALIDATION_ERROR;
    case 429:
      return API_ERROR_CODE.TOO_MANY_REQUESTS;
    case 502:
      return API_ERROR_CODE.BAD_GATEWAY;
    case 503:
      return API_ERROR_CODE.SERVICE_UNAVAILABLE;
    default:
      return API_ERROR_CODE.INTERNAL_SERVER_ERROR;
  }
};

/**
 * (a) UNWRAP — services and hooks work in domain types, never in envelopes.
 *
 * Every success body is `{ success, message, data?, meta? }`. Doing this here
 * rather than in each service is what stops thirty call sites each writing
 * `res.data.data` and one of them forgetting.
 */
const unwrap = (response: AxiosResponse): AxiosResponse => {
  // `noContentResponse` ends a 204 with no body at all; axios surfaces that as
  // an empty string, which is not a payload and must not reach a caller as one.
  if (
    response.status === 204 ||
    response.data === "" ||
    response.data == null
  ) {
    response.data = undefined;
    return response;
  }

  if (!isEnvelope(response.data)) {
    throw new ApiError({
      message: "The server returned an unexpected response.",
      status: 500,
      code: API_ERROR_CODE.UNEXPECTED_RESPONSE,
      requestId: readRequestId(response),
    });
  }

  const envelope = response.data;

  // A 2xx carrying `success: false` is a contract violation, but reporting it
  // as a success would hand the caller `undefined` where a payload belongs.
  if (envelope.success === false) {
    throw new ApiError({
      message: envelope.message || "The request failed.",
      status: response.status,
      code: envelope.code ?? API_ERROR_CODE.UNEXPECTED_RESPONSE,
      fieldErrors: envelope.errors,
      details: envelope.details,
      requestId: readRequestId(response),
    });
  }

  (response as UnwrappedResponse<unknown>).meta = envelope.meta;
  response.data = envelope.data;
  return response;
};

/**
 * (b) NORMALIZE — one error type leaves this module, always.
 *
 * A caller must be able to write `if (hasCode(error, "INSUFFICIENT_STOCK"))`
 * without first proving the failure even reached the server. A dead network,
 * a timeout, an HTML error page from a proxy and a proper 422 all become an
 * `ApiError`; only the `status`/`code` differ.
 */
const toApiError = (error: unknown): ApiError => {
  if (isApiError(error)) return error;

  if (axios.isCancel(error)) {
    return new ApiError({
      message: "The request was cancelled.",
      status: 0,
      code: API_ERROR_CODE.REQUEST_CANCELLED,
    });
  }

  // `axios.isAxiosError` reads the error's own `isAxiosError` flag instead of
  // testing `instanceof`, which is what makes it survive two copies of the
  // axios module in one graph (a bundle split, a test that reset its modules).
  if (!axios.isAxiosError(error)) {
    return new ApiError({
      message: error instanceof Error ? error.message : "Something went wrong.",
      status: 0,
      code: API_ERROR_CODE.NETWORK_ERROR,
    });
  }

  const { response } = error;
  if (!response) {
    const timedOut =
      error.code === AxiosError.ECONNABORTED ||
      error.code === AxiosError.ETIMEDOUT;
    return new ApiError({
      message: timedOut
        ? "The server took too long to respond."
        : "Cannot reach the server. Check your connection.",
      status: 0,
      code: timedOut ? API_ERROR_CODE.TIMEOUT : API_ERROR_CODE.NETWORK_ERROR,
    });
  }

  const envelope = isEnvelope(response.data) ? response.data : undefined;
  return new ApiError({
    message: envelope?.message || "The request failed.",
    status: response.status,
    code: envelope?.code ?? codeForStatus(response.status),
    fieldErrors: envelope?.errors,
    details: envelope?.details,
    requestId: readRequestId(response),
  });
};

/**
 * Sign-in endpoints. A 401 from one of these means "those credentials are
 * wrong", which the form shows inline — bouncing to `/login` from the login
 * page would wipe what the user typed and look like a crash.
 */
const AUTH_ENTRY_PATHS = [
  "/auth/login",
  "/auth/register",
  "/auth/accept-invite",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/verify-email",
  "/auth/2fa/challenge",
] as const;

const PASSKEY_LOGIN_PREFIX = "/auth/passkeys/login/";

/**
 * Pages that are reachable without a session. A background session probe
 * failing on one of these is the expected answer, not an expired session, so
 * it must not throw the visitor out of a registration or reset flow.
 * Kept local rather than imported from `config/routes.ts`, which the app-shell
 * lane owns; these seven paths are a property of the API's auth model.
 */
const ANONYMOUS_ROUTES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/accept-invite",
  "/verify-email",
  "/public",
] as const;

/** `config.url` is relative to `baseURL`, but tolerate an absolute one too. */
const requestPath = (url: string | undefined): string => {
  if (!url) return "";
  const withoutQuery = url.split("?")[0] ?? "";
  const absolute = /^[a-z][a-z0-9+.-]*:\/\/[^/]+(\/.*)?$/i.exec(withoutQuery);
  const path = absolute ? (absolute[1] ?? "/") : withoutQuery;
  return path.startsWith("/") ? path : `/${path}`;
};

const isAuthEntryRequest = (url: string | undefined): boolean => {
  const path = requestPath(url);
  if (!path) return false;
  return (
    AUTH_ENTRY_PATHS.some((entry) => path.endsWith(entry)) ||
    path.includes(PASSKEY_LOGIN_PREFIX)
  );
};

/**
 * One redirect, however many requests fail.
 *
 * An expired session fails every in-flight query at once — a dashboard fires
 * six. Without this flag each one calls `location.assign`, and the browser
 * gets six navigations whose `next` values race.
 */
let redirectingToLogin = false;

const redirectToLogin = (): void => {
  // (c) is a browser concern only. On the server there is no location to send
  // anywhere and no cache that belongs to a single user.
  if (typeof window === "undefined") return;
  if (redirectingToLogin) return;

  const { pathname, search } = window.location;
  if (
    ANONYMOUS_ROUTES.some(
      (route) => pathname === route || pathname.startsWith(`${route}/`),
    )
  ) {
    return;
  }

  redirectingToLogin = true;
  // Everything cached was fetched as the person who just stopped being signed
  // in. Leaving it would show the next user this device's previous tenant.
  getQueryClient().clear();
  window.location.assign(
    `/login?next=${encodeURIComponent(`${pathname}${search}`)}`,
  );
};

/**
 * (c) REACT — the two failures that are the app's problem, not the caller's.
 *
 * A 401 outside a sign-in flow means the cookie is gone or revoked (the API
 * re-reads the session on every request, so a remote logout lands here). No
 * form can recover from that, so the client handles it once, centrally.
 * A 429 is the rate limiter; the caller's own error UI would say "the request
 * failed" without explaining that waiting fixes it.
 */
const reactToFailure = (
  error: ApiError,
  requestUrl: string | undefined,
): void => {
  if (error.code === API_ERROR_CODE.TOO_MANY_REQUESTS || error.status === 429) {
    toast.error(error.message);
    return;
  }
  if (error.status === 401 && !isAuthEntryRequest(requestUrl))
    redirectToLogin();
};

api.interceptors.response.use(unwrap, (error: unknown) => {
  const apiError = toApiError(error);
  reactToFailure(
    apiError,
    axios.isAxiosError(error) ? error.config?.url : undefined,
  );
  return Promise.reject(apiError);
});

export async function apiGet<T>(
  url: string,
  config?: AxiosRequestConfig,
): Promise<T> {
  const response = await api.get<T>(url, config);
  return response.data;
}

/**
 * A paginated list. `meta` comes off the response object the interceptor
 * annotated (see `UnwrappedResponse`), so the caller gets rows and pagination
 * without ever touching an envelope.
 */
export async function apiGetList<T>(
  url: string,
  config?: AxiosRequestConfig,
): Promise<Paginated<T>> {
  const response = (await api.get<T[]>(url, config)) as UnwrappedResponse<T[]>;
  const items = response.data ?? [];
  return {
    items,
    // A list endpoint always sends `meta`. The fallback describes what did
    // arrive rather than zeros, so a paginator built on it renders one full
    // page instead of "0 of 0" over visible rows.
    meta: response.meta ?? {
      page: 1,
      limit: items.length,
      total: items.length,
      totalPages: 1,
    },
  };
}

export async function apiPost<T>(
  url: string,
  body?: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  const response = await api.post<T>(url, body, config);
  return response.data;
}

export async function apiPatch<T>(
  url: string,
  body?: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  const response = await api.patch<T>(url, body, config);
  return response.data;
}

/** `DELETE /auth/account` carries the current password in a body, so pass `{ data }`. */
export async function apiDelete<T>(
  url: string,
  config?: AxiosRequestConfig,
): Promise<T> {
  const response = await api.delete<T>(url, config);
  return response.data;
}
