// A plain-text summary of one customer's export (decision 87), to send a
// person who asked what the shop holds about them. The JSON file next to it
// is the complete record; this is the readable version.
import { formatMoney } from "@/lib/money";

type Row = Record<string, unknown>;
export type CustomerExport = {
  exported_at: string;
  shop: { name: string; address: string | null; phone: string | null; email: string | null };
  customer: Row;
  tickets: Row[];
  ticket_photos: Row[];
  invoices: Row[];
  payments: Row[];
  messages: Row[];
};

const str = (v: unknown) => (v === null || v === undefined || v === "" ? "" : String(v));
const day = (v: unknown) => str(v).slice(0, 10);

export function customerExportText(d: CustomerExport): string {
  const c = d.customer;
  const lines: string[] = [];
  const add = (label: string, v: unknown) => {
    if (str(v)) lines.push(`${label}: ${str(v)}`);
  };
  lines.push(`Information ${d.shop.name} holds about ${str(c["name"])}`);
  lines.push(`Prepared ${day(d.exported_at)}`, "");
  lines.push("CONTACT");
  add("Name", c["name"]);
  add("Mobile phone", c["phone"]);
  add("Email", c["email"]);
  add("Updates by", c["preferred_channel"] === "email" ? "Email" : "Text message");
  lines.push(`Texts: ${c["sms_opted_out"] ? "opted out" : "allowed"}`);
  lines.push(`Emails: ${c["email_opted_out"] ? "opted out" : "allowed"}`);
  add("Notes", c["notes"]);
  add("Customer since", day(c["created_at"]));

  lines.push("", `TICKETS (${d.tickets.length})`);
  for (const t of d.tickets) {
    lines.push("", `#${str(t["ticket_number"])} ${str(t["item_name"])} (${day(t["created_at"])})`);
    add("  Item", t["item_description"]);
    add("  Work", t["issue_description"]);
    add("  Notes for the customer", t["customer_notes"]);
    add("  Internal notes", t["internal_notes"]);
    add("  Picked up", day(t["picked_up_at"]));
    if (t["has_passcode"]) lines.push("  A device passcode is stored (encrypted; not shown here).");
    const photos = d.ticket_photos.filter((p) => p["ticket_id"] === t["id"]).length;
    if (photos) lines.push(`  Photos: ${photos}`);
  }

  if (d.invoices.length) {
    lines.push("", "INVOICES");
    for (const i of d.invoices)
      lines.push(
        `#${str(i["invoice_number"])} ${day(i["issued_at"])} ${formatMoney(Number(i["total_cents"]))}${i["voided_at"] ? " (voided)" : ""}`,
      );
  }
  if (d.payments.length) {
    lines.push("", "PAYMENTS");
    for (const p of d.payments)
      lines.push(
        `${day(p["paid_on"])} ${str(p["kind"])} ${formatMoney(Number(p["amount_cents"]))} (${str(p["method"]).replace("_", "-")})`,
      );
  }
  if (d.messages.length) {
    lines.push("", `MESSAGES SENT (${d.messages.length})`);
    for (const m of d.messages)
      lines.push(
        `${day(m["created_at"])} by ${m["channel"] === "sms" ? "text" : "email"}: ${str(m["body"])}`,
      );
  }

  const shop = [d.shop.address, d.shop.phone, d.shop.email].filter(Boolean).join(" · ");
  lines.push("", `Questions or corrections: ${d.shop.name}${shop ? `, ${shop}` : ""}`);
  return lines.join("\n") + "\n";
}

/**
 * A file name part from a person's name: accents dropped (é → e), anything
 * else that isn't a-z or 0-9 becomes a dash. Chromium ignores a download name
 * with non-ASCII characters and saves the file as "download".
 */
export function fileSlug(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "customer"
  );
}
