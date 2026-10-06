import { useRouter } from "@tanstack/react-router";
import { ImageUp, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { FormAlert } from "@/components/auth/AuthLayout";
import { Panel } from "@/components/app/Field";
import { Button } from "@/components/ui/button";
import { logoProblem, logoUrl, replaceLogo } from "@/lib/logo";
import { friendlyDbError } from "@/lib/shop";

// Shop logo on Settings → Shop. Shown on estimates and invoices (PDFs).
export function LogoPanel({
  shopId,
  logoPath,
  canEdit,
}: {
  shopId: string;
  logoPath: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void logoUrl(logoPath).then((u) => live && setSrc(u));
    return () => {
      live = false;
    };
  }, [logoPath]);

  async function change(file: File | null) {
    setError(null);
    if (file) {
      const problem = logoProblem(file);
      if (problem) return setError(problem);
    }
    setBusy(true);
    try {
      await replaceLogo(shopId, file);
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error && !("code" in err) ? err.message : friendlyDbError(err));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <Panel title="Logo" description="Printed at the top of your estimates and invoices.">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex h-24 w-48 shrink-0 items-center justify-center rounded-md border border-border bg-white p-2">
          {src ? (
            <img src={src} alt="Your shop logo" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-sm text-muted-foreground">No logo yet</span>
          )}
        </div>
        {canEdit ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => input.current?.click()}
              >
                <ImageUp /> {logoPath ? "Replace logo" : "Upload logo"}
              </Button>
              {logoPath ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void change(null)}
                >
                  <Trash2 /> Remove
                </Button>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">PNG or JPEG, up to 2 MB.</p>
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              aria-label="Logo file"
              onChange={(e) => void change(e.target.files?.[0] ?? null)}
            />
          </div>
        ) : null}
      </div>
      {error ? (
        <div className="mt-4">
          <FormAlert tone="error">{error}</FormAlert>
        </div>
      ) : null}
    </Panel>
  );
}
