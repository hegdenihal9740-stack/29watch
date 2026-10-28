REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

DROP POLICY IF EXISTS "Anyone reads active products" ON public.products;
DROP POLICY IF EXISTS "Authenticated users read active products" ON public.products;

CREATE POLICY "Anyone reads active products"
  ON public.products
  FOR SELECT
  TO anon
  USING (active);

CREATE POLICY "Authenticated users read active products"
  ON public.products
  FOR SELECT
  TO authenticated
  USING (active OR public.has_role(auth.uid(), 'admin'));
