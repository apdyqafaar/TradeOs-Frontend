import { describe, expect, it } from "vitest";
import { quotaFromRefusal } from "@/features/insights/hooks/use-digests";
import { ApiError } from "@/lib/api/errors";

const refusal = (code: string, details?: Record<string, unknown>): ApiError =>
  new ApiError({ message: "no", status: 429, code, details });

const QUOTA = {
  limit: 2,
  used: 2,
  remaining: 0,
  resetsAt: "2026-09-15T21:00:00.000Z",
};

describe("quotaFromRefusal", () => {
  it("reads the allowance a spent-quota refusal carries, so the header is right without a refetch", () => {
    expect(refusalQuota("DIGEST_QUOTA_EXHAUSTED", QUOTA)).toEqual(QUOTA);
  });

  it("ignores the loop-shield's bare 429, which carries no quota at all", () => {
    // `POST /digests/run` answers 429 twice over: `DIGEST_QUOTA_EXHAUSTED`
    // means "you have used today's two runs" and `TOO_MANY_REQUESTS` means
    // "you are calling this too fast". The backend gave them different codes
    // precisely so a client cannot conflate them, and branching on the status
    // would put whatever the limiter happened to attach into the header.
    expect(refusalQuota("TOO_MANY_REQUESTS", QUOTA)).toBeNull();
  });

  it("is null rather than a half-built quota when details are missing or wrong-typed", () => {
    // A `remaining` that is not a number would render as "2 of undefined left
    // today"; a partial object would render a count the server never sent.
    expect(refusalQuota("DIGEST_QUOTA_EXHAUSTED")).toBeNull();
    expect(
      refusalQuota("DIGEST_QUOTA_EXHAUSTED", { limit: 2, used: 2 }),
    ).toBeNull();
    expect(
      refusalQuota("DIGEST_QUOTA_EXHAUSTED", { ...QUOTA, remaining: "0" }),
    ).toBeNull();
  });

  it("is null for no error at all", () => {
    expect(quotaFromRefusal(null)).toBeNull();
  });
});

function refusalQuota(code: string, details?: Record<string, unknown>) {
  return quotaFromRefusal(refusal(code, details));
}
