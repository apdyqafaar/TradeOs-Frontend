import {
  apiDelete,
  apiGet,
  apiGetList,
  apiPatch,
  apiPost,
} from "@/lib/api/client";
import type { ObjectId, Paginated } from "@/lib/api/types";
import type {
  CreateCustomerInput,
  UpdateCustomerInput,
} from "../schemas/customer.schema";
import type {
  Customer,
  CustomerDetail,
  CustomerDetailResponse,
  CustomerListParams,
  ListedCustomer,
} from "../types";

/**
 * The only file in this slice that knows a URL exists.
 *
 * No React, no hooks, no query client, no toasts. It does no envelope handling
 * either: the response interceptor in `lib/api/client` has already unwrapped
 * `{ success, message, data, meta }` and turned every failure into an
 * `ApiError`, so what these functions return is the domain object.
 *
 * All five `/customers` rows in `docs/API-ROUTES.md` are wrapped here and
 * nothing else is. **No organization id is sent** — `requireMember` resolves
 * the tenant from the caller's own session on every request.
 */

const BASE = "/customers";

/**
 * `GET /customers` — `customers:view`. Paginated, so `apiGetList`.
 *
 * `{ params }`, not `params`: the second argument is an axios *config*, and
 * passing the filter object directly would hand axios a config full of keys it
 * does not recognise and send no query string at all — a list that silently
 * ignores every filter and stays on page 1. (The scaffolder's
 * `service.ts.template` writes `apiGetList(BASE, params)`; it is wrong.)
 *
 * Note what omitting `status` means: the backend defaults it to `"active"`, so
 * this is a list of active customers unless the caller says otherwise.
 */
export const list = (
  params: CustomerListParams,
): Promise<Paginated<ListedCustomer>> =>
  apiGetList<ListedCustomer>(BASE, { params });

/**
 * `GET /customers/:id` — `customers:view`.
 *
 * **The one place this slice reshapes a response, and it is deliberate.** The
 * controller answers `{ ...publicCustomer(customer), debtSummary }`
 * (`../Backend/src/controller/customer.controller.ts:57-64`): the customer's
 * own fields sit at the top level of `data` with `debtSummary` beside them.
 * Handing that shape straight to components would make `debtSummary` a
 * property of every `Customer` value that came from a detail fetch and of no
 * other, so `CustomerDetail` splits the two halves back apart here — once,
 * where the endpoint is named — rather than in each consumer.
 *
 * A 404 means the customer does not exist **or** belongs to another business;
 * the backend answers 404 for a cross-tenant id rather than 403 so an id
 * cannot be probed. Treat both as "not found".
 */
export const getById = async (id: ObjectId): Promise<CustomerDetail> => {
  const { debtSummary, ...customer } = await apiGet<CustomerDetailResponse>(
    `${BASE}/${id}`,
  );
  return { customer, debtSummary };
};

/**
 * `POST /customers` — `customers:create`. 201 with the created customer.
 *
 * A phone that already exists in this organization is a 409 `DUPLICATE_PHONE`,
 * compared after normalisation — see `CUSTOMER_CONFLICT_FIELDS`.
 */
export const create = (input: CreateCustomerInput): Promise<Customer> =>
  apiPost<Customer>(BASE, input);

/**
 * `PATCH /customers/:id` — `customers:update`. 200 with the full updated row,
 * and only the customer half: no `debtSummary` comes back from a PATCH.
 */
export const update = (
  id: ObjectId,
  input: UpdateCustomerInput,
): Promise<Customer> => apiPatch<Customer>(`${BASE}/${id}`, input);

/**
 * `DELETE /customers/:id` — `customers:delete`, and **not a delete**.
 *
 * It sets `status: "archived"` and returns the archived customer, which is why
 * this is typed `Promise<Customer>` rather than `void`: the row still exists,
 * `GET /customers/:id` still answers 200 for it, and the detail page the user
 * is standing on stays valid. Named `archive`, per brief §9 — the word the API
 * uses is the word the UI must use.
 *
 * It is refused with 409 `CUSTOMER_HAS_OPEN_DEBT` while the customer has any
 * debt in `status: "open"`, whatever the amount
 * (`../Backend/src/services/customer.service.ts:25-32`). That belongs inline
 * on the Archive control, not on a field.
 */
export const archive = (id: ObjectId): Promise<Customer> =>
  apiDelete<Customer>(`${BASE}/${id}`);
