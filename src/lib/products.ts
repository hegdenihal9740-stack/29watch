import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { watches, watchCloseups, type WatchTone } from "@/lib/watches";
import { prices } from "@/lib/cart";
import { cardMeta } from "@/lib/watch-meta";

export type ProductRow = Database["public"]["Tables"]["products"]["Row"];
export const BUILT_IN = ["steel", "black", "gold", "rosegold"];
export const isBuiltIn = (id: string) => BUILT_IN.includes(id);
const originalWatches = [...watches];
const originalPrices = { ...prices };
const originalCardMeta = { ...cardMeta };
export const builtInWatchImage = (id: string) =>
  originalWatches.find((watch) => watch.id === id)?.image;

/** Applies persisted visibility and pricing overrides to original and seller-added watches. */
export function applyProducts(rows: ProductRow[]) {
  const list = watches as unknown as Record<string, unknown>[];
  const uniqueRows = [...new Map(rows.map((row) => [row.id, row])).values()];
  list.splice(0, list.length, ...originalWatches);
  for (const id of Object.keys(prices)) {
    if (!isBuiltIn(id)) delete (prices as Record<string, number>)[id];
  }
  Object.assign(prices, originalPrices);
  for (const id of BUILT_IN) {
    const meta = originalCardMeta[id as keyof typeof originalCardMeta];
    if (meta) (cardMeta as Record<string, unknown>)[id] = { ...meta };
  }

  const builtInRows = new Map(
    uniqueRows.filter((row) => isBuiltIn(row.id)).map((row) => [row.id, row]),
  );
  for (let i = list.length - 1; i >= 0; i--) {
    const id = String(list[i]!["id"]);
    const row = builtInRows.get(id);
    if (!row) continue;
    if (!row.active) {
      list.splice(i, 1);
      continue;
    }
    (prices as Record<string, number>)[id] = row.price;
    (cardMeta as Record<string, unknown>)[id] = {
      ...(originalCardMeta as Record<string, Record<string, unknown>>)[id],
      list: Math.max(row.list_price, row.price),
    };
  }

  for (const r of uniqueRows) {
    if (isBuiltIn(r.id) || !r.active) continue;
    const id = r.id as WatchTone;
    list.push({
      id: r.id,
      name: r.name,
      finish: r.finish,
      image: r.image_url,
      images: Array.isArray(r.images) && r.images.length ? r.images : [r.image_url],
      description: r.description,
      details: r.details.length ? r.details : [r.finish],
    });
    (prices as Record<string, number>)[id] = r.price;
    (cardMeta as Record<string, unknown>)[id] = {
      list: Math.max(r.list_price, r.price),
      rating: 4.5,
      reviews: 0,
      bought: "New",
      badge: "New arrival",
      specs: r.details.slice(0, 3),
    };
    (watchCloseups as Record<string, unknown>)[id] = [0, 1, 2].map((n) => ({
      title: r.details[n] ?? r.name,
      description: r.description,
    }));
  }
}

let cache: { at: number; p: Promise<boolean> } | null = null;
export function ensureProducts(force = false) {
  if (!force && cache && Date.now() - cache.at < 60_000) return cache.p;
  const p = (async (): Promise<boolean> => {
    const { data, error } = await supabase.from("products").select("*").order("created_at");
    if (error) {
      console.error("[Products] Could not load the product catalog", error);
      return false;
    }
    if (!data) return false;
    applyProducts(data);
    return true;
  })();
  cache = { at: Date.now(), p };
  return p;
}

/** Shrinks an uploaded photo to a compact JPEG data URL stored with the product. */
export function photoToDataUrl(file: File, max = 900): Promise<string> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      let scale = Math.min(1, max / Math.max(img.width, img.height));
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const context = canvas.getContext("2d");
        if (!context) return rej(new Error("Could not prepare that photo."));
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", Math.max(0.5, 0.82 - attempt * 0.08));
        if (dataUrl.length <= 850_000) return res(dataUrl);
        scale *= 0.8;
      }
      rej(new Error("That photo is too large after compression. Choose a smaller image."));
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      rej(new Error("Could not read that image."));
    };
    img.src = URL.createObjectURL(file);
  });
}

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
