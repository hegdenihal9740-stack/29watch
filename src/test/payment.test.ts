import { describe, expect, it } from "vitest";
import { getPaymentTotal } from "@/lib/payment";
import { createUpiPaymentUri, UPI_PAYMENT_VPA } from "@/lib/upi";

describe("online payment totals", () => {
  it("calculates INR totals from the trusted server catalog", () => {
    expect(
      getPaymentTotal([
        { id: "steel", qty: 1 },
        { id: "gold", qty: 2 },
      ]),
    ).toBe(49800);
  });

  describe("direct UPI payment details", () => {
    it("creates an order-specific INR payment URI for the configured payee", () => {
      const uri = createUpiPaymentUri({
        vpa: UPI_PAYMENT_VPA,
        payeeName: "BIG-B",
        amountRupees: 12800,
        orderId: "PF0123456789ABCDEF0123",
      });
      const parsed = new URL(uri);

      expect(parsed.protocol).toBe("upi:");
      expect(parsed.hostname).toBe("pay");
      expect(parsed.searchParams.get("pa")).toBe("nihalhegde550-1@oksbi");
      expect(parsed.searchParams.get("am")).toBe("12800.00");
      expect(parsed.searchParams.get("tr")).toBe("PF0123456789ABCDEF0123");
      expect(parsed.searchParams.get("cu")).toBe("INR");
    });

    it("rejects invalid UPI payment totals", () => {
      expect(() =>
        createUpiPaymentUri({
          vpa: UPI_PAYMENT_VPA,
          payeeName: "BIG-B",
          amountRupees: 0,
          orderId: "PF0123456789ABCDEF0123",
        }),
      ).toThrow();
    });
  });

  it("prices seller-added watches using server-provided catalog prices", () => {
    expect(getPaymentTotal([{ id: "titanium-diver", qty: 2 }], { "titanium-diver": 22000 })).toBe(
      44000,
    );
  });

  it("uses the current server catalog price for original watches", () => {
    expect(getPaymentTotal([{ id: "steel", qty: 1 }], { steel: 13000 })).toBe(13000);
  });

  it("rejects custom watches that are not present in the active catalog", () => {
    expect(() => getPaymentTotal([{ id: "unknown-watch", qty: 1 }])).toThrow();
  });

  it("rejects duplicate product lines to prevent ambiguous carts", () => {
    expect(() =>
      getPaymentTotal([
        { id: "steel", qty: 1 },
        { id: "steel", qty: 1 },
      ]),
    ).toThrow();
  });

  it("rejects invalid quantities", () => {
    expect(() => getPaymentTotal([{ id: "steel", qty: 0 }])).toThrow();
    expect(() => getPaymentTotal([{ id: "steel", qty: 21 }])).toThrow();
  });
});
