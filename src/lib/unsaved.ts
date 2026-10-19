import { createContext, useContext, useEffect, useId, useRef } from "react";

// Unsaved changes (19 Oct feedback, item 17; decision 99). Each edit form
// registers whether it has unsaved edits and how to save them; one dialog in
// the app layout (UnsavedChangesDialog) asks Save / Discard / Keep editing
// before any in-app navigation, so two open forms never stack two dialogs.

type Entry = { dirty: boolean; save: () => Promise<boolean> };

export class UnsavedRegistry {
  private entries = new Map<string, Entry>();
  set(id: string, entry: Entry) {
    this.entries.set(id, entry);
  }
  delete(id: string) {
    this.entries.delete(id);
  }
  anyDirty(): boolean {
    for (const e of this.entries.values()) if (e.dirty) return true;
    return false;
  }
  /** Saves every dirty form in turn; stops at the first that fails (it shows its own error). */
  async saveAll(): Promise<boolean> {
    for (const e of [...this.entries.values()]) {
      if (e.dirty && !(await e.save())) return false;
    }
    return true;
  }
}

export const UnsavedContext = createContext<UnsavedRegistry | null>(null);

/**
 * `save` resolves to true when the form saved; false keeps the person on the
 * page. Outside the app layout (no registry) this does nothing.
 */
export function useUnsavedChanges(dirty: boolean, save: () => Promise<boolean>) {
  const registry = useContext(UnsavedContext);
  const id = useId();
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    if (!registry) return;
    registry.set(id, { dirty, save: () => saveRef.current() });
    return () => registry.delete(id);
  }, [registry, id, dirty]);
}
