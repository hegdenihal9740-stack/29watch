import { z } from "zod";

export const MAX_PRODUCT_IMAGES = 5;
const MAX_PRODUCT_IMAGE_DATA_URL_LENGTH = 900_000;

export const productImageDataUrlSchema = z
  .string()
  .max(MAX_PRODUCT_IMAGE_DATA_URL_LENGTH)
  .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/);

export const productImageGallerySchema = z
  .array(productImageDataUrlSchema)
  .min(1, "Add at least one product photo.")
  .max(MAX_PRODUCT_IMAGES, `Choose no more than ${MAX_PRODUCT_IMAGES} photos.`)
  .refine(
    (images) => images.reduce((total, image) => total + image.length, 0) <= 4_500_000,
    "The selected photos are too large. Choose smaller images.",
  );
