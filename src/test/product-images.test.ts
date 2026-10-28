import { describe, expect, it } from "vitest";
import { MAX_PRODUCT_IMAGES, productImageGallerySchema } from "@/lib/product-images";

const image = "data:image/jpeg;base64,/9j/2Q==";

describe("product image gallery validation", () => {
  it("accepts one or more compressed JPEG images", () => {
    expect(productImageGallerySchema.parse([image, image])).toHaveLength(2);
  });

  it("rejects an empty image selection", () => {
    expect(productImageGallerySchema.safeParse([]).success).toBe(false);
  });

  it("rejects more than the supported gallery size", () => {
    expect(
      productImageGallerySchema.safeParse(Array(MAX_PRODUCT_IMAGES + 1).fill(image)).success,
    ).toBe(false);
  });

  it("rejects unsupported image data", () => {
    expect(productImageGallerySchema.safeParse(["data:image/png;base64,AAAA"]).success).toBe(false);
  });

  it("rejects gallery payloads that exceed the request size limit", () => {
    const oversized = `data:image/jpeg;base64,${"A".repeat(900_000)}`;
    expect(productImageGallerySchema.safeParse([oversized]).success).toBe(false);
  });
});
