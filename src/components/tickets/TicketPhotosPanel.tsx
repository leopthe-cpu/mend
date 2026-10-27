import { Camera, ChevronRight } from "lucide-react";
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
  // Empty sections stay folded (Oz, 16 Oct); open to add the first photos.
  const [open, setOpen] = useState(false);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const problems = await uploadPhotos(ticket.shop_id, ticket.id, files);
    setMsg(problems.length ? problems.join(" ") : null);
    await onReload();
    // Clear so re-uploading the same file triggers onChange again.
    e.target.value = "";
  }

  if (!photos.length && !open) {
    return (
      <button
        type="button"
        aria-expanded={false}
        onClick={() => setOpen(true)}
        className="flex min-h-14 w-full items-center gap-3 rounded-[1.75rem] border border-border bg-card px-6 text-left hover:bg-accent"
      >
        <ChevronRight className="size-5 shrink-0" aria-hidden />
        <span className="text-xl font-semibold">Photos</span>
        <span className="text-muted-foreground">None yet</span>
      </button>
    );
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
        className="mt-4 inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-input px-4 font-medium hover:bg-accent"
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
