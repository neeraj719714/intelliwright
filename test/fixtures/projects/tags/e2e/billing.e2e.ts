import { test } from "intelliwright";

test.describe("billing", () => {
  test("shows invoices", { tag: "@regression" }, async () => {});

  test("pays an invoice @slow", async () => {});
});

test("refunds a payment", async () => {
  if (process.env.FAIL_REFUNDS) throw new Error("refund failed");
});
