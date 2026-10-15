import { Camera } from "lucide-react";
import { useState } from "react";

import { Panel } from "@/components/app/Field";
import { uploadPhotos, type Ticket } from "@/lib/tickets";

type Photo = { id: string; storage_path: string; url?: string };

export function TicketPhotosPanel({
  ticket,
  photos,
  onReload,
}: {
  ticket: Ticket;
  photos: Photo[];
  onReload: () => void;
}) {
  const [msg, setMsg] = useState<string | null>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const problems = await uploadPhotos(ticket.shop_id, ticket.id, files);
    setMsg(problems.length ? problems.join(" ") : null);
    await onReload();
    // Clear so re-uploading the same file triggers onChange again.
    e.target.value = "";
  }

  return (
    <Panel title="Photos">
      {msg ? <p className="mb-4 text-sm text-danger">{msg}</p> : null}
      {photos.length ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((p) => (
            <li key={p.id}>
              {p.url ? (
                <a href={p.url} target="_blank" rel="noreferrer">
                  <img
                    src={p.url}
                    alt="Condition photo"
                    className="aspect-square w-full rounded-md object-cover"
                    loading="lazy"
                  />
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">No photos yet.</p>
      )}
      <label
        htmlFor="more-photos"
        className="mt-4 inline-flex h-11 cursor-pointer items-center gap-2 rounded-md border border-input px-4 font-medium hover:bg-accent"
      >
        <Camera className="size-5" aria-hidden /> Add photos
      </label>
      <input
        id="more-photos"
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="sr-only"
        onChange={(e) => void handleUpload(e)}
      />
    </Panel>
  );
}
