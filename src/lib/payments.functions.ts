import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  createCodOrder as createCodOrderOnServer,
  createUpiPaymentRequest as createUpiPaymentRequestOnServer,
  confirmUpiPaymentRequest as confirmUpiPaymentRequestOnServer,
  getUpiPaymentRequestStatus,
  listUpiPaymentRequests as listUpiPaymentRequestsOnServer,
  rejectUpiPaymentRequest as rejectUpiPaymentRequestOnServer,
  submitUpiPaymentReference,
} from "@/lib/payment.server";

const lineSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}$/),
  qty: z.number().int().min(1).max(20),
});

const addressSchema = z.object({
  name: z.string().trim().min(1).max(100),
  mobile: z.string().regex(/^[6-9]\d{9}$/),
  address: z.string().trim().min(1).max(500),
  locality: z.string().max(150).optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  pincode: z.string().regex(/^\d{6}$/),
  landmark: z.string().max(150).optional(),
  type: z.string().max(30).optional(),
});

export const createUpiPaymentOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z.object({
      items: z.array(lineSchema).min(1).max(4),
      address: addressSchema,
    }),
  )
  .handler(async ({ data, context }) =>
    createUpiPaymentRequestOnServer(context.userId, data.items, data.address),
  );

export const submitUpiPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z.object({
      requestId: z.string().regex(/^PF[A-F0-9]{20}$/),
      paymentReference: z
        .string()
        .trim()
        .min(6)
        .max(50)
        .regex(/^[A-Za-z0-9-]+$/),
    }),
  )
  .handler(async ({ data, context }) =>
    submitUpiPaymentReference(context.userId, data.requestId, data.paymentReference),
  );

export const getUpiPaymentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ requestId: z.string().regex(/^PF[A-F0-9]{20}$/) }))
  .handler(async ({ data, context }) => getUpiPaymentRequestStatus(context.userId, data.requestId));

export const listUpiPaymentRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => listUpiPaymentRequestsOnServer(context.userId));

export const confirmUpiPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ requestId: z.string().regex(/^PF[A-F0-9]{20}$/) }))
  .handler(async ({ data, context }) =>
    confirmUpiPaymentRequestOnServer(context.userId, data.requestId),
  );

export const rejectUpiPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ requestId: z.string().regex(/^PF[A-F0-9]{20}$/) }))
  .handler(async ({ data, context }) =>
    rejectUpiPaymentRequestOnServer(context.userId, data.requestId),
  );

export const createCodOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z.object({
      items: z.array(lineSchema).min(1).max(4),
      address: addressSchema,
    }),
  )
  .handler(async ({ data, context }) =>
    createCodOrderOnServer(
      context.userId,
      data.items,
      data.address,
      context.supabase,
      typeof context.claims["email"] === "string" ? context.claims["email"] : null,
    ),
  );
