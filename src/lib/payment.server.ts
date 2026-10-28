import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { getPaymentTotal, type PaymentLine } from "@/lib/payment";
import { watchPrices } from "@/lib/watches";
import { sendOrderNotifications, sendOwnerOrderNotifications } from "@/lib/notifications.server";
import { STORE_CONTACT } from "@/lib/store-info";
import {
  UPI_PAYMENT_VPA,
  UPI_PAYMENT_WINDOW_MS,
  createUpiPaymentUri,
  type UpiPaymentRequest,
} from "@/lib/upi";

export type PaymentAddress = {
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

export async function priceOrderLines(
  lines: PaymentLine[],
  client: SupabaseClient<Database> = supabaseAdmin,
) {
  const productIds = [...new Set(lines.map((line) => line.id))];
  const productPrices: Record<string, number> = {};
  if (productIds.length) {
    const { data, error } = await client
      .from("products")
      .select("id,price")
      .in("id", productIds)
      .eq("active", true);
    if (error) {
      console.error("[Orders] Could not validate products", error);
      throw new Error("Could not validate your cart. Please try again.");
    }
    for (const product of data ?? []) productPrices[product.id] = product.price;
  }

  const total = getPaymentTotal(lines, productPrices);
  return {
    total,
    items: lines.map((line) => {
      const price =
        productPrices[line.id] ??
        (Object.hasOwn(watchPrices, line.id)
          ? watchPrices[line.id as keyof typeof watchPrices]
          : undefined);
      if (price === undefined) throw new Error("Your cart contains an invalid item or quantity");
      return { ...line, price };
    }),
  };
}

function validateAddress(address: PaymentAddress): PaymentAddress {
  if (
    !address ||
    typeof address.name !== "string" ||
    !address.name.trim() ||
    typeof address.mobile !== "string" ||
    !/^[6-9]\d{9}$/.test(address.mobile) ||
    typeof address.address !== "string" ||
    !address.address.trim() ||
    typeof address.city !== "string" ||
    !address.city.trim() ||
    typeof address.state !== "string" ||
    !address.state.trim() ||
    typeof address.pincode !== "string" ||
    !/^\d{6}$/.test(address.pincode)
  ) {
    throw new Error("Please provide a valid delivery address before paying");
  }
  return address;
}

function decodePaymentAddress(value: unknown): PaymentAddress {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Payment order has an invalid delivery address");
  }
  const address = value as Record<string, unknown>;
  if (
    typeof address["name"] !== "string" ||
    typeof address["mobile"] !== "string" ||
    typeof address["address"] !== "string" ||
    typeof address["city"] !== "string" ||
    typeof address["state"] !== "string" ||
    typeof address["pincode"] !== "string"
  ) {
    throw new Error("Payment order has an invalid delivery address");
  }
  return validateAddress({
    name: address["name"],
    mobile: address["mobile"],
    address: address["address"],
    city: address["city"],
    state: address["state"],
    pincode: address["pincode"],
    ...(typeof address["locality"] === "string" ? { locality: address["locality"] } : {}),
    ...(typeof address["landmark"] === "string" ? { landmark: address["landmark"] } : {}),
    ...(typeof address["type"] === "string" ? { type: address["type"] } : {}),
  });
}

function decodePaymentLines(value: unknown): PaymentLine[] {
  if (!Array.isArray(value)) throw new Error("Payment order has invalid items");
  return value.map((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof item["id"] !== "string" ||
      typeof item["qty"] !== "number" ||
      !Number.isInteger(item["qty"]) ||
      item["qty"] < 1
    ) {
      throw new Error("Payment order has invalid items");
    }
    return { id: item["id"], qty: item["qty"] };
  });
}

export async function createCodOrder(
  userId: string,
  lines: PaymentLine[],
  rawAddress: PaymentAddress,
  userClient: SupabaseClient<Database>,
  email: string | null,
) {
  const { total, items } = await priceOrderLines(lines, userClient);
  const address = validateAddress(rawAddress);
  const id = `PF${randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`;
  const { error } = await userClient.from("orders").insert({
    id,
    user_id: userId,
    items,
    total,
    payment: "cod",
    address,
  });
  if (error) {
    console.error("[Orders] Could not create COD order", { orderId: id, error });
    throw new Error(
      error.message.includes("OUT_OF_STOCK")
        ? "Sorry, one of these watches just went out of stock."
        : "Could not place your order. Please try again.",
    );
  }
  const notificationInput = {
    orderId: id,
    email,
    name: address.name,
    mobile: address.mobile,
    total,
    items,
    status: "confirmed",
    payment: "cod",
  };
  const [notifications, ownerNotifications] = await Promise.all([
    sendOrderNotifications(notificationInput),
    sendOwnerOrderNotifications(notificationInput, {
      name: STORE_CONTACT.name,
      email: STORE_CONTACT.email,
    }),
  ]);
  return { orderId: id, total, notifications, ownerNotifications };
}

export async function createUpiPaymentRequest(
  userId: string,
  lines: PaymentLine[],
  rawAddress: PaymentAddress,
) {
  const { total, items } = await priceOrderLines(lines);
  const address = validateAddress(rawAddress);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + UPI_PAYMENT_WINDOW_MS).toISOString();
  const { error: expireError } = await supabaseAdmin
    .from("upi_payment_requests")
    .update({ status: "expired" })
    .eq("user_id", userId)
    .eq("status", "awaiting_payment")
    .lt("expires_at", now.toISOString());
  if (expireError) {
    console.error("[Payment] Could not expire old UPI payment requests", expireError);
    throw new Error("Could not start UPI payment. Please try again.");
  }
  const { data: activeRequest, error: activeError } = await supabaseAdmin
    .from("upi_payment_requests")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "awaiting_payment")
    .gt("expires_at", now.toISOString())
    .limit(1)
    .maybeSingle();
  if (activeError) {
    console.error("[Payment] Could not check existing UPI payment request", activeError);
    throw new Error("Could not start UPI payment. Please try again.");
  }
  if (activeRequest) {
    throw new Error(
      "Wait for your existing five-minute UPI QR window to end before starting another.",
    );
  }
  const id = `PF${randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`;
  const { error } = await supabaseAdmin.from("upi_payment_requests").insert({
    id,
    user_id: userId,
    items,
    total,
    address,
    expires_at: expiresAt,
  });
  if (error) {
    console.error("[Payment] Could not create UPI payment request", { orderId: id, error });
    throw new Error("Could not start UPI payment. Please try again.");
  }
  return {
    requestId: id,
    total,
    expiresAt,
    paymentUri: createUpiPaymentUri({
      vpa: UPI_PAYMENT_VPA,
      payeeName: STORE_CONTACT.name,
      amountRupees: total,
      orderId: id,
    }),
  };
}

export async function submitUpiPaymentReference(
  userId: string,
  requestId: string,
  paymentReference: string,
) {
  const { data: request, error: readError } = await supabaseAdmin
    .from("upi_payment_requests")
    .select("id,status,expires_at")
    .eq("id", requestId)
    .eq("user_id", userId)
    .maybeSingle();
  if (readError || !request) {
    console.error("[Payment] Could not load UPI payment request", { requestId, error: readError });
    throw new Error("Could not find this UPI payment request. Please contact the store.");
  }
  if (request.status !== "awaiting_payment" && request.status !== "expired") {
    throw new Error("This UPI payment request has already been submitted.");
  }
  const status =
    request.status === "expired" || Date.now() > Date.parse(request.expires_at)
      ? "late_review"
      : "awaiting_review";
  const { data, error } = await supabaseAdmin
    .from("upi_payment_requests")
    .update({ payment_reference: paymentReference, status })
    .eq("id", requestId)
    .eq("user_id", userId)
    .in("status", ["awaiting_payment", "expired"])
    .select("id,status")
    .maybeSingle();
  if (error || !data) {
    console.error("[Payment] Could not submit UPI payment reference", {
      requestId,
      error,
    });
    throw new Error("Could not submit payment details. Refresh and try again.");
  }
  return { requestId: data.id, status: data.status };
}

export async function getUpiPaymentRequestStatus(userId: string, requestId: string) {
  const { data, error } = await supabaseAdmin
    .from("upi_payment_requests")
    .select("id,total,status,expires_at")
    .eq("id", requestId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) {
    console.error("[Payment] Could not read UPI payment status", { requestId, error });
    throw new Error("Could not refresh payment status. Please try again.");
  }
  return {
    requestId: data.id,
    total: data.total,
    status: data.status,
    expiresAt: data.expires_at,
  };
}

async function requireStorePaymentAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) {
    console.error("[Payment] Could not verify seller permissions", error);
    throw new Error("Could not verify store permissions. Please try again.");
  }
  if (!data) throw new Error("You do not have permission to verify UPI payments.");
}

export async function listUpiPaymentRequests(userId: string) {
  await requireStorePaymentAdmin(userId);
  const { data, error } = await supabaseAdmin
    .from("upi_payment_requests")
    .select("*")
    .in("status", ["awaiting_review", "late_review"])
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) {
    console.error("[Payment] Could not load UPI review queue", error);
    throw new Error("Could not load UPI payments. Please refresh and try again.");
  }
  return data.map((request): UpiPaymentRequest => {
    if (!Array.isArray(request.items)) {
      throw new Error("A UPI payment request contains invalid items.");
    }
    const items = request.items.map((item) => {
      if (
        typeof item !== "object" ||
        item === null ||
        Array.isArray(item) ||
        typeof item["id"] !== "string" ||
        typeof item["qty"] !== "number" ||
        !Number.isInteger(item["qty"]) ||
        typeof item["price"] !== "number" ||
        !Number.isSafeInteger(item["price"]) ||
        item["price"] < 1
      ) {
        throw new Error("A UPI payment request contains invalid items.");
      }
      return { id: item["id"], qty: item["qty"], price: item["price"] };
    });
    const status = request.status;
    if (status !== "awaiting_review" && status !== "late_review") {
      throw new Error("A UPI payment request has an invalid review status.");
    }
    return {
      id: request.id,
      user_id: request.user_id,
      items,
      total: request.total,
      address: decodePaymentAddress(request.address),
      expires_at: request.expires_at,
      status,
      payment_reference: request.payment_reference,
      created_at: request.created_at,
    };
  });
}

export async function confirmUpiPaymentRequest(userId: string, requestId: string) {
  await requireStorePaymentAdmin(userId);
  const { data, error } = await supabaseAdmin.rpc("confirm_upi_payment", {
    _request_id: requestId,
  });
  if (error) {
    console.error("[Payment] Could not confirm UPI payment", { requestId, error });
    throw new Error(
      error.message.includes("OUT_OF_STOCK")
        ? "Payment was received, but an item is out of stock. Contact the customer to arrange a refund."
        : "Could not confirm this payment. Refresh and try again.",
    );
  }
  if (
    typeof data !== "object" ||
    data === null ||
    Array.isArray(data) ||
    typeof data["order_id"] !== "string" ||
    typeof data["confirmed_now"] !== "boolean"
  ) {
    throw new Error("The database returned an invalid payment confirmation.");
  }
  if (!data["confirmed_now"]) {
    return { orderId: data["order_id"], notifications: null, ownerNotifications: null };
  }

  const { data: order, error: orderError } = await supabaseAdmin
    .from("orders")
    .select("id,user_id,items,total,address,status,payment,tracking_url")
    .eq("id", data["order_id"])
    .maybeSingle();
  if (orderError || !order) {
    console.error("[Payment] Confirmed UPI order could not be loaded for email", {
      requestId,
      error: orderError,
    });
    throw new Error("Payment was confirmed, but order details could not be loaded.");
  }
  const { data: account, error: accountError } = await supabaseAdmin.auth.admin.getUserById(
    order.user_id,
  );
  if (accountError) {
    console.error("[Payment] Could not read customer email after UPI verification", {
      orderId: order.id,
      error: accountError,
    });
  }
  const address = decodePaymentAddress(order.address);
  const items = decodePaymentLines(order.items);
  const notificationInput = {
    orderId: order.id,
    email: account?.user?.email ?? null,
    name: address.name,
    mobile: address.mobile,
    total: order.total,
    items,
    status: "confirmed",
    payment: "upi",
  };
  const [notifications, ownerNotifications] = await Promise.all([
    sendOrderNotifications(notificationInput),
    sendOwnerOrderNotifications(notificationInput, {
      name: STORE_CONTACT.name,
      email: STORE_CONTACT.email,
    }),
  ]);
  return {
    orderId: order.id,
    notifications,
    ownerNotifications,
  };
}

export async function rejectUpiPaymentRequest(userId: string, requestId: string) {
  await requireStorePaymentAdmin(userId);
  const { data, error } = await supabaseAdmin
    .from("upi_payment_requests")
    .update({ status: "rejected" })
    .eq("id", requestId)
    .in("status", ["awaiting_review", "late_review"])
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[Payment] Could not reject UPI payment request", { requestId, error });
    throw new Error("Could not reject this payment request. Please try again.");
  }
  if (!data) throw new Error("This payment request has already been handled.");
  return { requestId };
}
