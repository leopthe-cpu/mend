import { getSupabase } from "./supabase";

// Every file a shop has in Storage: intake photos at
// ticket-photos/<shop_id>/<ticket_id>/<file> and logos at
// shop-logos/<shop_id>/<file>. Used before deleting a shop: Storage files can
// only be removed through the Storage API (a SQL delete is refused and would
// leave the file behind), and delete_shop refuses while any remain.
const BUCKETS = ["ticket-photos", "shop-logos"] as const;
const PAGE = 1000;

async function listAll(bucket: string, prefix: string): Promise<string[]> {
  const sb = getSupabase();
  const paths: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: PAGE, offset });
    if (error) throw new Error("Couldn't list the shop's files. Please try again.");
    for (const entry of data) {
      // Folders come back with a null id (storage-js FileObject).
      if (entry.id === null) paths.push(...(await listAll(bucket, `${prefix}/${entry.name}`)));
      else paths.push(`${prefix}/${entry.name}`);
    }
    if (data.length < PAGE) return paths;
  }
}

export async function removeShopFiles(shopId: string): Promise<void> {
  const sb = getSupabase();
  for (const bucket of BUCKETS) {
    const paths = await listAll(bucket, shopId);
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await sb.storage.from(bucket).remove(paths.slice(i, i + 100));
      if (error) throw new Error("Couldn't remove the shop's photos. Please try again.");
    }
  }
}
