INSERT INTO public.products (
  id,
  name,
  finish,
  price,
  list_price,
  description,
  details,
  image_url,
  images,
  active
)
VALUES
  (
    'steel',
    'Steel Diver',
    'Brushed steel',
    12800,
    14900,
    'Cool brushed metal, a dark dial and a sculpted bracelet. A study in sharp contrasts.',
    ARRAY['Dark dial', 'Date window', 'Linked bracelet'],
    '',
    '{}',
    true
  ),
  (
    'black',
    'Black Skeleton',
    'Blackened metal',
    14500,
    16900,
    'A dark silhouette with an exposed mechanical character. Warm accents bring the dial into focus.',
    ARRAY['Skeleton-style dial', 'Dark metal case', 'Mechanical detailing'],
    '',
    '{}',
    true
  ),
  (
    'gold',
    'Gold Chronograph',
    'Polished gold',
    18500,
    21500,
    'Polished golden surfaces meet a layered chronograph-style dial, with fine details at every angle.',
    ARRAY['Subdial detailing', 'Polished finish', 'Side pushers'],
    '',
    '{}',
    true
  ),
  (
    'rosegold',
    'Rose Gold',
    'Rose gold',
    16900,
    18900,
    'Warm rose-toned metal frames a light face. A dark textured strap brings a softer contrast to the polished case.',
    ARRAY['Rose-toned case', 'Light dial', 'Textured strap'],
    '',
    '{}',
    true
  )
ON CONFLICT (id) DO NOTHING;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

DROP POLICY IF EXISTS "Anyone reads active products" ON public.products;
DROP POLICY IF EXISTS "Authenticated users read active products" ON public.products;

CREATE POLICY "Anyone reads active products"
  ON public.products
  FOR SELECT
  TO anon
  USING (active OR id IN ('steel', 'black', 'gold', 'rosegold'));

CREATE POLICY "Authenticated users read active products"
  ON public.products
  FOR SELECT
  TO authenticated
  USING (
    active
    OR id IN ('steel', 'black', 'gold', 'rosegold')
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE OR REPLACE FUNCTION public.validate_customer_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  line jsonb;
  expected_price integer;
  expected_total integer := 0;
  verified_items jsonb := '[]'::jsonb;
  quantity integer;
  product_id text;
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NEW.payment <> 'cod' OR jsonb_typeof(NEW.items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid cash-on-delivery order';
  END IF;
  IF jsonb_array_length(NEW.items) < 1 OR jsonb_array_length(NEW.items) > 4 THEN
    RAISE EXCEPTION 'Invalid cash-on-delivery order';
  END IF;

  FOR line IN SELECT value FROM jsonb_array_elements(NEW.items) AS entries(value) LOOP
    product_id := line->>'id';
    IF product_id IS NULL OR product_id !~ '^[a-z0-9][a-z0-9-]{0,59}$'
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(verified_items) AS saved(value)
        WHERE saved.value->>'id' = product_id
      ) THEN
      RAISE EXCEPTION 'Invalid or repeated order item';
    END IF;
    IF COALESCE(line->>'qty', '') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Invalid order quantity';
    END IF;
    quantity := (line->>'qty')::integer;
    IF quantity < 1 OR quantity > 20 THEN
      RAISE EXCEPTION 'Invalid order quantity';
    END IF;

    SELECT price INTO expected_price
    FROM public.products
    WHERE id = product_id AND active = true;
    IF expected_price IS NULL OR expected_price < 1 THEN
      RAISE EXCEPTION 'Invalid or inactive product';
    END IF;

    expected_total := expected_total + expected_price * quantity;
    verified_items := verified_items || jsonb_build_array(
      jsonb_build_object('id', product_id, 'qty', quantity, 'price', expected_price)
    );
  END LOOP;

  NEW.user_id := auth.uid();
  NEW.payment := 'cod';
  NEW.items := verified_items;
  NEW.total := expected_total;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.validate_customer_order() FROM PUBLIC, anon, authenticated;
