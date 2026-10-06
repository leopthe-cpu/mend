import { useNavigate } from "@tanstack/react-router";
import { Camera, UserPlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { FormAlert } from "@/components/auth/AuthLayout";
import { Field, selectClass } from "@/components/app/Field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { friendlyDbError, type Membership } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
import {
  fetchCustomFields,
  fetchMembers,
  uploadPhotos,
  type CustomField,
  type Member,
} from "@/lib/tickets";
import { CustomFieldInput } from "./CustomFieldInput";

// Intake (spec §7.2): the most frequent action, built to take under a minute.
// Find or create the customer, the item and issue, optional details, photos,
// terms, save. Everything is validated again by the database.
type Found = { id: string; label: string };

export function NewTicketDialog({
  open,
  onOpenChange,
  membership,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  membership: Membership;
}) {
  const shop = membership.shop;
  const navigate = useNavigate();
  const [fields, setFields] = useState<CustomField[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [customer, setCustomer] = useState<Found | null>(null);
  const [creating, setCreating] = useState(false);
  const [newCust, setNewCust] = useState({
    name: "",
    phone: "",
    email: "",
    channel: "sms" as "sms" | "email",
  });
  const [item, setItem] = useState("");
  const [issue, setIssue] = useState("");
  const [promised, setPromised] = useState("");
  const [assignee, setAssignee] = useState("");
  const [custom, setCustom] = useState<Record<string, string | number | undefined>>({});
  const [passcode, setPasscode] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const searchSeq = useRef(0);

  useEffect(() => {
    if (!open) return;
    void fetchCustomFields(shop.id)
      .then(setFields)
      .catch(() => setFields([]));
    void fetchMembers(shop.id)
      .then(setMembers)
      .catch(() => setMembers([]));
  }, [open, shop.id]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || customer) return setFound([]);
    const seq = ++searchSeq.current;
    const timer = setTimeout(async () => {
      const { data } = await getSupabase().rpc("search_shop", { p_shop_id: shop.id, p_query: q });
      if (seq !== searchSeq.current) return;
      const rows = ((data ?? []) as { kind: string; id: string; label: string }[]).filter(
        (r) => r.kind === "customer",
      );
      setFound(
        rows
          .filter((r, i) => rows.findIndex((x) => x.id === r.id) === i)
          .map((r) => ({ id: r.id, label: r.label })),
      );
    }, 200);
    return () => clearTimeout(timer);
  }, [query, customer, shop.id]);

  function reset() {
    setQuery("");
    setFound([]);
    setCustomer(null);
    setCreating(false);
    setNewCust({ name: "", phone: "", email: "", channel: "sms" });
    setItem("");
    setIssue("");
    setPromised("");
    setAssignee("");
    setCustom({});
    setPasscode("");
    setPhotos([]);
    setTerms(false);
    setError(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!customer && !creating) return setError("Choose a customer or add a new one.");
    if (!item.trim()) return setError("Enter the item, for example iPhone 13 or Winter coat.");
    if (shop.terms_text && !terms) return setError("The customer needs to accept the terms.");
    for (const f of fields)
      if (f.required && (custom[f.id] === undefined || custom[f.id] === ""))
        return setError(`${f.label} is required.`);
    setSaving(true);
    try {
      const sb = getSupabase();
      let customerId = customer?.id;
      if (!customerId) {
        const { data, error } = await sb.rpc("save_customer", {
          p_shop_id: shop.id,
          p_customer_id: null,
          p_name: newCust.name,
          p_phone: newCust.phone || null,
          p_email: newCust.email || null,
          p_preferred_channel: newCust.channel,
          p_notes: null,
        });
        if (error) throw error;
        customerId = data as string;
      }
      const cleanCustom = Object.fromEntries(
        Object.entries(custom).filter(([, v]) => v !== undefined && v !== ""),
      );
      const { data, error } = await sb.rpc("create_ticket", {
        p_shop_id: shop.id,
        p_customer_id: customerId,
        p_item_name: item,
        p_issue_description: issue || null,
        p_item_description: null,
        p_promised_date: promised || null,
        p_assigned_to: assignee || null,
        p_custom_fields: cleanCustom,
        p_passcode: passcode || null,
        p_terms_accepted: terms,
      });
      if (error) throw error;
      const created = (data as { ticket_id: string; ticket_number: number }[])[0];
      if (!created) throw new Error("no ticket");
      const problems = photos.length ? await uploadPhotos(shop.id, created.ticket_id, photos) : [];
      reset();
      onOpenChange(false);
      await navigate({
        to: "/app/tickets/$ticketId",
        params: { ticketId: created.ticket_id },
        search: { created: 1, photoProblems: problems.length },
      });
    } catch (err) {
      setError(friendlyDbError(err));
    } finally {
      setSaving(false);
    }
  }

  const isElectronics = shop.vertical === "electronics";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="surface-light max-h-[92svh] overflow-y-auto bg-background text-foreground sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">New ticket</DialogTitle>
          <DialogDescription>Log the item, the customer and what needs doing.</DialogDescription>
        </DialogHeader>
        <form method="post" onSubmit={save} className="flex flex-col gap-5">
          {/* Customer */}
          <section className="flex flex-col gap-3">
            <h3 className="font-semibold">Customer</h3>
            {customer ? (
              <div className="flex items-center justify-between rounded-md border border-input bg-surface-2 px-4 py-3">
                <span className="font-medium">{customer.label}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCustomer(null);
                    setQuery("");
                  }}
                >
                  <X /> Change
                </Button>
              </div>
            ) : creating ? (
              <div className="grid gap-4 rounded-md border border-input p-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Field id="nc-name" label="Name">
                    <Input
                      id="nc-name"
                      value={newCust.name}
                      onChange={(e) => setNewCust({ ...newCust, name: e.target.value })}
                      maxLength={120}
                      autoFocus
                    />
                  </Field>
                </div>
                <Field id="nc-phone" label="Mobile phone">
                  <Input
                    id="nc-phone"
                    type="tel"
                    inputMode="tel"
                    value={newCust.phone}
                    onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })}
                  />
                </Field>
                <Field id="nc-email" label="Email">
                  <Input
                    id="nc-email"
                    type="email"
                    value={newCust.email}
                    onChange={(e) => setNewCust({ ...newCust, email: e.target.value })}
                  />
                </Field>
                <Field id="nc-channel" label="Prefers">
                  <select
                    id="nc-channel"
                    className={selectClass}
                    value={newCust.channel}
                    onChange={(e) =>
                      setNewCust({ ...newCust, channel: e.target.value as "sms" | "email" })
                    }
                  >
                    <option value="sms">Text message</option>
                    <option value="email">Email</option>
                  </select>
                </Field>
                <div className="flex items-end">
                  <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                    Search instead
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Field id="cust-search" label="Find by name, phone or email">
                  <Input
                    id="cust-search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Maria, 416 555 0100…"
                    autoFocus
                    autoComplete="off"
                  />
                </Field>
                {found.length ? (
                  <ul className="divide-y divide-border rounded-md border border-border bg-surface-2">
                    {found.map((f) => (
                      <li key={f.id}>
                        <button
                          type="button"
                          className="flex min-h-11 w-full items-center px-4 text-left hover:bg-accent"
                          onClick={() => setCustomer(f)}
                        >
                          {f.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setCreating(true);
                    setNewCust({
                      ...newCust,
                      name: /\d|@/.test(query) ? "" : query,
                      phone: /^[\d\s()+-]+$/.test(query) ? query : "",
                      email: query.includes("@") ? query : "",
                    });
                  }}
                >
                  <UserPlus /> New customer
                </Button>
              </div>
            )}
          </section>

          {/* Item */}
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field id="item" label="Item">
                <Input
                  id="item"
                  value={item}
                  onChange={(e) => setItem(e.target.value)}
                  placeholder="iPhone 13, Winter coat, Snowboard…"
                  maxLength={120}
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field id="issue" label="What needs doing">
                <Textarea
                  id="issue"
                  value={issue}
                  onChange={(e) => setIssue(e.target.value)}
                  rows={3}
                  maxLength={4000}
                  className="bg-surface-2 text-base"
                />
              </Field>
            </div>
            <Field id="promised" label="Promised date (optional)">
              <Input
                id="promised"
                type="date"
                value={promised}
                onChange={(e) => setPromised(e.target.value)}
              />
            </Field>
            <Field id="assignee" label="Assigned to (optional)">
              <select
                id="assignee"
                className={selectClass}
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
              >
                <option value="">Nobody yet</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name || m.email}
                  </option>
                ))}
              </select>
            </Field>
            {fields.map((f) => (
              <Field
                key={f.id}
                id={`cf-${f.id}`}
                label={f.required ? f.label : `${f.label} (optional)`}
                hint={f.help_text}
              >
                <CustomFieldInput
                  id={`cf-${f.id}`}
                  field={f}
                  value={custom[f.id]}
                  onChange={(v) => setCustom({ ...custom, [f.id]: v })}
                />
              </Field>
            ))}
            {isElectronics ? (
              <Field
                id="passcode"
                label="Device passcode (optional)"
                hint="Stored encrypted. Only the owner, admins and the assigned person can reveal it. Deleted at pickup."
              >
                <Input
                  id="passcode"
                  type="password"
                  autoComplete="off"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  maxLength={64}
                />
              </Field>
            ) : null}
          </section>

          {/* Photos */}
          <section className="flex flex-col gap-2">
            <label
              htmlFor="photos"
              className="inline-flex h-11 w-fit cursor-pointer items-center gap-2 rounded-md border border-input px-4 font-medium hover:bg-accent"
            >
              <Camera className="size-5" aria-hidden /> Add condition photos
            </label>
            <input
              id="photos"
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="sr-only"
              onChange={(e) => setPhotos([...photos, ...Array.from(e.target.files ?? [])])}
            />
            {photos.length ? (
              <p className="text-sm text-muted-foreground">
                {photos.length} photo{photos.length > 1 ? "s" : ""} ready to upload (10 MB max
                each).
              </p>
            ) : null}
          </section>

          {/* Terms */}
          {shop.terms_text ? (
            <section className="flex flex-col gap-2 rounded-md border border-border bg-card p-4">
              <p className="max-h-28 overflow-y-auto whitespace-pre-wrap text-sm text-muted-foreground">
                {shop.terms_text}
              </p>
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={terms}
                  onChange={(e) => setTerms(e.target.checked)}
                />
                <span>The customer accepts these terms</span>
              </label>
            </section>
          ) : null}

          {error ? <FormAlert tone="error">{error}</FormAlert> : null}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="lg" disabled={saving}>
              {saving ? "Saving…" : "Save ticket"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
