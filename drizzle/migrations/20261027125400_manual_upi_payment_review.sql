CREATE TABLE public.upi_payment_requests (
  id text PRIMARY KEY CHECK (id ~ '^PF[A-F0-9]{20}$'),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array'),
  total integer NOT NULL CHECK (total > 0),
  address jsonb NOT NULL CHECK (jsonb_typeof(address) = 'object'),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  status text NOT NULL DEFAULT 'awaiting_payment'
    CHECK (status IN ('awaiting_payment', 'expired', 'awaiting_review', 'late_review', 'confirmed', 'rejected')),
  payment_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);

ALTER TABLE public.upi_payment_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.upi_payment_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.upi_payment_requests TO service_role;

CREATE INDEX upi_payment_requests_review_queue_idx
  ON public.upi_payment_requests (created_at DESC)
  WHERE status IN ('awaiting_review', 'late_review');

CREATE OR REPLACE FUNCTION public.confirm_upi_payment(_request_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  payment_request public.upi_payment_requests;
BEGIN
  SELECT * INTO payment_request
  FROM public.upi_payment_requests
  WHERE id = _request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'UPI payment request not found';
  END IF;

  IF payment_request.status = 'confirmed' THEN
    RETURN jsonb_build_object('order_id', payment_request.id, 'confirmed_now', false);
  END IF;

  IF payment_request.status NOT IN ('awaiting_review', 'late_review')
    OR payment_request.payment_reference IS NULL THEN
    RAISE EXCEPTION 'UPI payment request is not ready for verification';
  END IF;

  INSERT INTO public.orders (
    id, user_id, items, total, payment, payment_reference, address
  )
  VALUES (
    payment_request.id,
    payment_request.user_id,
    payment_request.items,
    payment_request.total,
    'upi',
    payment_request.payment_reference,
    payment_request.address
  );

  UPDATE public.upi_payment_requests
  SET status = 'confirmed', confirmed_at = now()
  WHERE id = payment_request.id;

  RETURN jsonb_build_object('order_id', payment_request.id, 'confirmed_now', true);
END
$$;

REVOKE ALL ON FUNCTION public.confirm_upi_payment(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_upi_payment(text) TO service_role;
