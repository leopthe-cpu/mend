import { getSupabase } from "./supabase";

// Shop logos (decision 57): private bucket "shop-logos", path
// <shop_id>/<random>.png|jpg. The bucket itself also enforces 2 MB and
// PNG/JPEG; these checks just give a clear message before uploading.
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const TYPES: Record<string, "png" | "jpg"> = { "image/png": "png", "image/jpeg": "jpg" };

export function logoProblem(file: File): string | null {
  if (!TYPES[file.type]) return "Use a PNG or JPEG image.";
  if (file.size > LOGO_MAX_BYTES) return "That image is over 2 MB. Try a smaller one.";
  return null;
}

/** A short-lived link to show the logo (10 minutes), or null. */
export async function logoUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await getSupabase().storage.from("shop-logos").createSignedUrl(path, 600);
  return data?.signedUrl ?? null;
}

/** Uploads the file, makes it the shop's logo, then removes the old file. */
export async function replaceLogo(shopId: string, file: File | null): Promise<void> {
  const sb = getSupabase();
  let path: string | null = null;
  if (file) {
    const ext = TYPES[file.type];
    if (!ext) throw new Error("Use a PNG or JPEG image.");
    path = `${shopId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage
      .from("shop-logos")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw new Error("Couldn't upload the logo. Please try again.");
  }
  const { data: old, error } = await sb.rpc("set_shop_logo", { p_shop_id: shopId, p_path: path });
  if (error) {
    // Don't leave the new file behind if it couldn't be used.
    if (path) await sb.storage.from("shop-logos").remove([path]);
    throw error;
  }
  if (typeof old === "string" && old && old !== path) {
    await sb.storage.from("shop-logos").remove([old]);
  }
}
