// Deletes the photo files of tickets past the shop's retention period
// (decision 86), then runs the purge for those tickets. Invoked daily by
// pg_cron (private.retention_daily) only when photos are due. Safe to call by
// anyone: it only deletes what retention_claim_photos() says is due, and the
// database refuses to purge a ticket while photo rows remain. Storage files
// can't be deleted with SQL, hence this function.
import { adminClient, json } from "../_shared/admin.ts";

const BUCKET = "ticket-photos";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const db = adminClient();

  let removed = 0;
  // Up to 5 batches of 100 per run (the app deletes 100 files per call too); tomorrow's run picks up the rest.
  for (let batch = 0; batch < 5; batch++) {
    const { data, error } = await db.rpc("retention_claim_photos", { p_limit: 100 });
    if (error) return json({ error: error.message }, 500);
    const due = (data ?? []) as { photo_id: string; storage_path: string }[];
    if (!due.length) break;

    const { error: rmError } = await db.storage.from(BUCKET).remove(due.map((p) => p.storage_path));
    if (rmError) return json({ error: rmError.message, removed }, 500);

    const { data: n, error: rowError } = await db.rpc("retention_photos_removed", {
      p_photo_ids: due.map((p) => p.photo_id),
    });
    if (rowError) return json({ error: rowError.message, removed }, 500);
    removed += (n as number | null) ?? 0;
  }

  const { data: run, error: runError } = await db.rpc("retention_run");
  if (runError) return json({ error: runError.message, removed }, 500);
  return json({ photos_removed: removed, ...(run as Record<string, number>) });
});
