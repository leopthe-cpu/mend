import { useBlocker } from "@tanstack/react-router";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { UnsavedRegistry } from "@/lib/unsaved";

// The one "unsaved changes" question for the whole app (decision 99). In-app
// navigation to another page waits for an answer; closing or reloading the tab
// can only get the browser's own "Leave site?" prompt (browsers don't allow a
// custom dialog there).
export function UnsavedChangesDialog({ registry }: { registry: UnsavedRegistry }) {
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) => current.pathname !== next.pathname && registry.anyDirty(),
    enableBeforeUnload: () => registry.anyDirty(),
    withResolver: true,
  });
  const [saving, setSaving] = useState(false);

  async function saveAndLeave() {
    if (blocker.status !== "blocked") return;
    setSaving(true);
    const ok = await registry.saveAll();
    setSaving(false);
    // A failed save keeps the person on the page, where the form shows why.
    if (ok) blocker.proceed();
    else blocker.reset();
  }

  return (
    <AlertDialog
      open={blocker.status === "blocked"}
      onOpenChange={(open) => {
        if (!open && !saving && blocker.status === "blocked") blocker.reset();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Save your changes?</AlertDialogTitle>
          <AlertDialogDescription>
            You changed something on this page and haven&rsquo;t saved it yet.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <Button variant="ghost" disabled={saving} onClick={() => blocker.reset?.()}>
            Keep editing
          </Button>
          <Button variant="outline" disabled={saving} onClick={() => blocker.proceed?.()}>
            Discard
          </Button>
          <Button disabled={saving} onClick={() => void saveAndLeave()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
