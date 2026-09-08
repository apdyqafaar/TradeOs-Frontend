import { describe, expect, it } from "vitest";
import { createCustomerSchema, updateCustomerSchema } from "./customer.schema";

describe("createCustomerSchema", () => {
  it("requires a phone number — it is how a shop chases a debt", () => {
    expect(
      createCustomerSchema.safeParse({ name: "Bakaara Wholesale" }).success,
    ).toBe(false);
  });

  it("accepts the shapes people actually type", () => {
    for (const phone of [
      "+252 61 234 5678",
      "0712-345-678",
      "(020) 555 0134",
    ]) {
      expect(
        createCustomerSchema.safeParse({ name: "Bakaara", phone }).success,
        phone,
      ).toBe(true);
    }
  });

  it("rejects letters in a phone number", () => {
    expect(
      createCustomerSchema.safeParse({ name: "Bakaara", phone: "call me" })
        .success,
    ).toBe(false);
  });

  it("treats an omitted email as absent, not as an empty string", () => {
    const parsed = createCustomerSchema.safeParse({
      name: "Bakaara",
      phone: "0712345678",
    });
    expect(parsed.success && "email" in parsed.data).toBe(false);
  });

  // Beyond the plan, and load-bearing for the Task 8 sheet: an untouched
  // optional <input> submits "", and the API's `email` is format-checked, so a
  // literal "" would come back as a 422 on a field the user never filled in.
  it("drops a blank email instead of sending one the API would refuse", () => {
    for (const email of ["", "   "]) {
      const parsed = createCustomerSchema.safeParse({
        name: "Bakaara",
        phone: "0712345678",
        email,
      });
      expect(parsed.success, JSON.stringify(email)).toBe(true);
      expect(parsed.success && parsed.data.email).toBeUndefined();
      // `JSON.stringify` drops an undefined value, so the request body omits
      // the key entirely rather than sending `email: null`.
      expect(parsed.success && JSON.stringify(parsed.data)).not.toContain(
        "email",
      );
    }
  });

  it("lower-cases an email, because the API stores it lower-cased", () => {
    const parsed = createCustomerSchema.safeParse({
      name: "Bakaara",
      phone: "0712345678",
      email: " Sales@BAKAARA.CO ",
    });
    expect(parsed.success && parsed.data.email).toBe("sales@bakaara.co");
  });

  it("holds the backend's bounds: phone 5..32, name 1..120", () => {
    const ok = { name: "Bakaara", phone: "0712345678" };
    expect(
      createCustomerSchema.safeParse({ ...ok, phone: "1234" }).success,
    ).toBe(false);
    expect(
      createCustomerSchema.safeParse({ ...ok, phone: "1".repeat(33) }).success,
    ).toBe(false);
    expect(createCustomerSchema.safeParse({ ...ok, name: "" }).success).toBe(
      false,
    );
    expect(
      createCustomerSchema.safeParse({ ...ok, name: "n".repeat(121) }).success,
    ).toBe(false);
  });

  it("refuses a field the strict body would 422 on", () => {
    expect(
      createCustomerSchema.safeParse({
        name: "Bakaara",
        phone: "0712345678",
        organizationId: "68e0c2b0f0a1b2c3d4e5f601",
      }).success,
    ).toBe(false);
  });
});

describe("updateCustomerSchema", () => {
  it("refuses an empty patch, which the API answers 422 to", () => {
    expect(updateCustomerSchema.safeParse({}).success).toBe(false);
  });

  it("accepts one field on its own", () => {
    expect(
      updateCustomerSchema.safeParse({ address: "Stall 14, Bakaara" }).success,
    ).toBe(true);
  });

  it("lets an empty address through, because that is how a field is cleared", () => {
    const parsed = updateCustomerSchema.safeParse({ address: "" });
    expect(parsed.success && parsed.data.address).toBe("");
  });

  it("can restore an archived customer but cannot archive one", () => {
    // PATCH only accepts `status: "active"` — archiving is DELETE /customers/:id.
    expect(updateCustomerSchema.safeParse({ status: "active" }).success).toBe(
      true,
    );
    expect(updateCustomerSchema.safeParse({ status: "archived" }).success).toBe(
      false,
    );
  });
});
