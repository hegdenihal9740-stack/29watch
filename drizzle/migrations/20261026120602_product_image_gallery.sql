ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS images text[] NOT NULL DEFAULT '{}';

UPDATE public.products
SET images = ARRAY[image_url]
WHERE cardinality(images) = 0
  AND image_url <> '';

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('product-images', 'product-images', true, 6291456)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = GREATEST(
      COALESCE(storage.buckets.file_size_limit, 0),
      EXCLUDED.file_size_limit
    );