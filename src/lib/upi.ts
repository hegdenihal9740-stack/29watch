export const UPI_PAYMENT_VPA = "nihalhegde550-1@oksbi";
export const UPI_PAYMENT_WINDOW_MS = 5 * 60 * 1000;

export type UpiPaymentRequest = {
  id: string;
  user_id: string;
  items: { id: string; qty: number; price: number }[];
  total: number;
  address: {
    name: string;
    mobile: string;
    address: string;
    locality?: string | undefined;
    city: string;
    state: string;
    pincode: string;
    landmark?: string | undefined;
    type?: string | undefined;
  };
  expires_at: string;
  status:
    "awaiting_payment" | "expired" | "awaiting_review" | "late_review" | "confirmed" | "rejected";
  payment_reference: string | null;
  created_at: string;
};

export function createUpiPaymentUri(input: {
  vpa: string;
  payeeName: string;
  amountRupees: number;
  orderId: string;
}) {
  if (!Number.isSafeInteger(input.amountRupees) || input.amountRupees < 1) {
    throw new Error("UPI payment amount must be a positive whole number of rupees.");
  }
  const params = new URLSearchParams({
    pa: input.vpa,
    pn: input.payeeName,
    am: input.amountRupees.toFixed(2),
    tr: input.orderId,
    tn: `BIG-B order ${input.orderId}`,
    cu: "INR",
  });
  return `upi://pay?${params.toString()}`;
}
