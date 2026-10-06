import { createFileRoute } from "@tanstack/react-router";
import { Download, Trash2 } from "lucide-react";
import { useState } from "react";

import { Panel } from "@/components/app/Field";
import { ReauthDialog } from "@/components/app/ReauthDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { downloadFile, toCsv } from "@/lib/csv";
import { friendlyDbError } from "@/lib/shop";
import { removeShopFiles } from "@/lib/shopFiles";
import { getSupabase } from "@/lib/supabase";

// Owner-only data export (spec §4 "per-shop data export", decision 56). The
// database builds the whole export (export_shop) after a fresh password; the
// browser only turns it into files. Nothing is sent anywhere else.
export const Route = createFileRoute("/app/settings/data")({
  head: () => ({ meta: [{ title: "Your data · Mend" }] }),
  component: DataSettings,
});

// Only the fields the spreadsheets use; the JSON file keeps everything.
type ExportCustomer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  preferred_channel: string | null;
  sms_opted_out: boolean;
  email_opted_out: boolean;
  notes: string | null;
  created_at: string;
};
type ExportTicket = {
  ticket_number: number;
  created_at: string;
  customer_id: string;
  item_name: string;
  issue_description: string | null;
  status_id: string;
  promised_date: string | null;
  picked_up_at: string | null;
  deleted_at: string | null;
};
type ShopExport = {
  exported_at: string;
  customers: ExportCustomer[];
  tickets: ExportTicket[];
  statuses: { id: string; name: string }[];
};

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function DataSettings() {
  const { membership, user } = Route.useRouteContext();
  const shop = membership.shop;
  const [asking, setAsking] = useState(false);
  const [data, setData] = useState<ShopExport | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [typedName, setTypedName] = useState("");

  if (membership.role !== "owner") {
    return (
      <Panel title="Your data">
        <p className="text-muted-foreground">Only the shop's owner can download its data.</p>
      </Panel>
    );
  }

  const stamp = (data?.exported_at ?? "").slice(0, 10);
  const base = `mend-${shop.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${stamp}`;

  function downloadJson() {
    if (!data) return;
    downloadFile(`${base}.json`, JSON.stringify(data, null, 2), "application/json");
  }

  function downloadCustomers() {
    if (!data) return;
    downloadFile(
      `${base}-customers.csv`,
      toCsv(
        ["Name", "Phone", "Email", "Prefers", "No texts", "No emails", "Notes", "Added"],
        data.customers.map((c) => [
          str(c.name),
          str(c.phone),
          str(c.email),
          str(c.preferred_channel),
          c.sms_opted_out ? "yes" : "",
          c.email_opted_out ? "yes" : "",
          str(c.notes),
          str(c.created_at).slice(0, 10),
        ]),
      ),
      "text/csv;charset=utf-8",
    );
  }

  function downloadTickets() {
    if (!data) return;
    const customers = new Map(data.customers.map((c) => [c.id, str(c.name)]));
    const statuses = new Map(data.statuses.map((s) => [s.id, str(s.name)]));
    downloadFile(
      `${base}-tickets.csv`,
      toCsv(
        [
          "Ticket",
          "Received",
          "Customer",
          "Item",
          "What needs doing",
          "Status",
          "Promised",
          "Picked up",
          "Deleted",
        ],
        data.tickets.map((t) => [
          Number(t.ticket_number),
          str(t.created_at).slice(0, 10),
          customers.get(t.customer_id) ?? "",
          str(t.item_name),
          str(t.issue_description),
          statuses.get(t.status_id) ?? "",
          str(t.promised_date),
          str(t.picked_up_at).slice(0, 10),
          t.deleted_at ? "yes" : "",
        ]),
      ),
      "text/csv;charset=utf-8",
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Panel
        title="Download your data"
        description="Everything in your shop: customers with their contact details, tickets, estimates, invoices, payments, messages, your price list, settings, team and the activity log."
      >
        {!data ? (
          <>
            <p className="text-sm text-muted-foreground">
              Device passcodes are never included. Photos are listed but not downloaded. Each
              download is recorded in the activity log.
            </p>
            <Button className="mt-4" onClick={() => setAsking(true)}>
              <Download /> Prepare download
            </Button>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Ready: {data.customers.length} customers and {data.tickets.length} tickets.
              Spreadsheet files open in Excel, Numbers or Google Sheets.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button onClick={downloadCustomers}>
                <Download /> Customers (spreadsheet)
              </Button>
              <Button onClick={downloadTickets}>
                <Download /> Tickets (spreadsheet)
              </Button>
              <Button variant="outline" onClick={downloadJson}>
                <Download /> Everything (JSON)
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              The JSON file has everything, for moving to another system.
            </p>
          </div>
        )}
      </Panel>

      <Panel
        title="Delete this shop"
        description="Permanently deletes the shop and everything in it: customers, tickets, photos, estimates, invoices, payments, messages, settings and the activity log. Your team loses access. This can't be undone."
      >
        <p className="text-sm text-muted-foreground">
          Download your data first if you might need it. Everyone keeps their Mend login.
        </p>
        <Button
          variant="destructive"
          className="mt-4"
          onClick={() => {
            setTypedName("");
            setDeleting(true);
          }}
        >
          <Trash2 /> Delete shop
        </Button>
      </Panel>

      {deleting ? (
        <ReauthDialog
          title={`Delete ${shop.name}?`}
          description="Everything in this shop is deleted for good, for everyone on your team."
          email={user.email ?? ""}
          confirmLabel="Delete shop forever"
          busyLabel="Deleting…"
          destructive
          canConfirm={typedName.trim().toLowerCase() === shop.name.trim().toLowerCase()}
          onClose={() => setDeleting(false)}
          action={async () => {
            await removeShopFiles(shop.id);
            const { error } = await getSupabase().rpc("delete_shop", {
              p_shop_id: shop.id,
              p_confirm_name: typedName,
            });
            if (error) throw new Error(friendlyDbError(error));
            // Signed out so the app doesn't open a fresh shop straight away
            // (decision 53); logging in again starts over.
            await getSupabase().auth.signOut();
            window.location.assign("/");
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirm-name">
              Type <span className="font-semibold">{shop.name}</span> to confirm
            </Label>
            <Input
              id="confirm-name"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              autoComplete="off"
            />
          </div>
        </ReauthDialog>
      ) : null}

      {asking ? (
        <ReauthDialog
          title="Confirm it's you"
          description="Your download includes every customer's phone number and email, so we ask for your password first."
          email={user.email ?? ""}
          confirmLabel="Prepare download"
          busyLabel="Preparing…"
          onClose={() => setAsking(false)}
          action={async () => {
            const { data, error } = await getSupabase().rpc("export_shop", {
              p_shop_id: shop.id,
            });
            if (error) throw new Error(friendlyDbError(error));
            setData(data as ShopExport);
            setAsking(false);
          }}
        />
      ) : null}
    </div>
  );
}
