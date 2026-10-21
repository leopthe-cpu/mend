import { useEffect, useState } from "react";

import { FormAlert } from "@/components/auth/AuthLayout";
import { CustomerFields } from "@/components/customers/CustomerFields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { loadCustomerForm, saveCustomerForm, type CustomerFormValues } from "@/lib/customerForm";
import { useUnsavedChanges } from "@/lib/unsaved";

// Fix a customer's phone or email without leaving the ticket (19 Oct
// feedback, item 18; decision 100). Same form and save as the customer page.
export function EditCustomerDialog({
  open,
  onOpenChange,
  shopId,
  customerId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shopId: string;
  customerId: string;
  onSaved: () => void | Promise<void>;
}) {
  const [form, setForm] = useState<CustomerFormValues | null>(null);
  const [loaded, setLoaded] = useState<CustomerFormValues | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Closing with unsaved edits asks first, like leaving a page (decision 99).
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(null);
    setError(null);
    setConfirmClose(false);
    void loadCustomerForm(customerId).then((r) => {
      if ("error" in r) return setError(r.error);
      setForm(r.values);
      setLoaded(r.values);
    });
  }, [open, customerId]);

  const dirty = open && !!form && JSON.stringify(form) !== JSON.stringify(loaded);

  async function save(): Promise<boolean> {
    if (!form) return false;
    setSaving(true);
    setError(null);
    const err = await saveCustomerForm(shopId, customerId, form);
    setSaving(false);
    if (err) {
      setError(err);
      setConfirmClose(false);
      return false;
    }
    await onSaved();
    onOpenChange(false);
    return true;
  }
  useUnsavedChanges(dirty, save);

  function requestClose() {
    if (dirty) setConfirmClose(true);
    else onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : requestClose())}>
      <DialogContent className="max-h-[92svh] overflow-y-auto bg-background text-foreground sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl">Edit customer</DialogTitle>
          <DialogDescription>
            Changes apply to all of this customer&rsquo;s tickets.
          </DialogDescription>
        </DialogHeader>
        {error ? <FormAlert tone="error">{error}</FormAlert> : null}
        {form ? (
          <form
            id="edit-customer"
            method="post"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <fieldset disabled={saving} className="contents">
              <CustomerFields value={form} onChange={setForm} idPrefix="ec" />
            </fieldset>
          </form>
        ) : !error ? (
          <p role="status">Loading…</p>
        ) : null}
        {confirmClose ? (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-lg bg-card p-4 sm:flex-row sm:items-center"
          >
            <p className="flex-1 font-medium">Save your changes?</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => setConfirmClose(false)}>
                Keep editing
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Discard
              </Button>
              <Button disabled={saving} onClick={() => void save()}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        ) : (
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={requestClose}>
              Cancel
            </Button>
            <Button type="submit" form="edit-customer" disabled={!form || saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
