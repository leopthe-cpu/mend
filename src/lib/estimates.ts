import { getSupabase } from "@/lib/supabase";

// Read-side types and helpers for estimates, invoices and payments. Every
// write goes through the database functions (migration 20261006050000_money),
// which compute and store all totals; the browser never computes money it saves.

export type EstimateStatus = "draft" | "sent" | "approved" | "declined" | "superseded";
export type ApprovalMethod = "in_person" | "phone" | "text_reply" | "email_reply" | "other";
export type TaxLine = {
  id: string;
  name: string;
  rate: number;
  taxable_cents: number;
  tax_cents: number;
};

export type Estimate = {
  id: string;
  ticket_id: string;
  version: number;
  status: EstimateStatus;
  sent_at: string | null;
  approved_at: string | null;
  approval_method: ApprovalMethod | null;
  declined_at: string | null;
  superseded_at: string | null;
  subtotal_before_cents: number;
  savings_cents: number;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  tax_breakdown: TaxLine[];
  created_at: string;
};

export type Line = {
  id: string;
  estimate_id: string;
  position: number;
  catalog_item_id: string | null;
  is_custom: boolean;
  name_snapshot: string;
  unit_snapshot: "each" | "hour";
  catalog_unit_price_cents: number | null;
  unit_price_cents: number;
  quantity: number;
  discount_type: "percent" | "fixed" | null;
  discount_value: number | null;
  discount_source: "catalog" | "manual" | null;
  discount_reason: string | null;
  tax_snapshot: { id: string; name: string; rate: number }[];
  line_subtotal_cents: number;
  discount_cents: number;
  line_total_cents: number;
};

export type Invoice = {
  id: string;
  estimate_id: string;
  invoice_number: number;
  issued_at: string;
  voided_at: string | null;
  subtotal_before_cents: number;
  savings_cents: number;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  tax_breakdown: TaxLine[];
  shop_snapshot: {
    name: string;
    address: string | null;
    phone: string | null;
    email: string | null;
    tax_registration_number: string | null;
    currency: string;
  };
};

export type PaymentKind = "deposit" | "payment" | "refund";
export type PaymentMethod = "cash" | "card" | "e_transfer" | "other";
export type Payment = {
  id: string;
  kind: PaymentKind;
  method: PaymentMethod;
  amount_cents: number;
  paid_on: string;
  note: string | null;
  recorded_by: string | null;
  recorded_at: string;
};

export const APPROVAL_LABEL: Record<ApprovalMethod, string> = {
  in_person: "in person",
  phone: "by phone",
  text_reply: "by text reply",
  email_reply: "by email reply",
  other: "another way",
};
export const STATUS_LABEL: Record<EstimateStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  approved: "Approved",
  declined: "Declined",
  superseded: "Replaced",
};
export const KIND_LABEL: Record<PaymentKind, string> = {
  deposit: "Deposit",
  payment: "Payment",
  refund: "Refund",
};
export const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  card: "Card",
  e_transfer: "e-Transfer",
  other: "Other",
};

// bigint columns arrive as numbers from PostgREST for values this size; numeric
// columns may arrive as strings, so normalize everything we do arithmetic on.
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

export type MoneyData = {
  estimates: Estimate[];
  lines: Line[];
  invoices: Invoice[];
  payments: Payment[];
};

export async function fetchMoney(ticketId: string): Promise<MoneyData> {
  const db = getSupabase();
  const [e, i, p] = await Promise.all([
    db
      .from("estimates")
      .select("*")
      .eq("ticket_id", ticketId)
      .order("version", { ascending: false }),
    db
      .from("invoices")
      .select("*")
      .eq("ticket_id", ticketId)
      .order("invoice_number", { ascending: false }),
    db.from("payments").select("*").eq("ticket_id", ticketId).order("paid_on").order("recorded_at"),
  ]);
  if (e.error) throw e.error;
  if (i.error) throw i.error;
  if (p.error) throw p.error;
  const estimates = (e.data ?? []).map((x) => ({
    ...x,
    subtotal_before_cents: num(x.subtotal_before_cents),
    savings_cents: num(x.savings_cents),
    subtotal_cents: num(x.subtotal_cents),
    tax_cents: num(x.tax_cents),
    total_cents: num(x.total_cents),
  })) as Estimate[];
  let lines: Line[] = [];
  if (estimates.length) {
    const l = await db
      .from("estimate_line_items")
      .select("*")
      .in(
        "estimate_id",
        estimates.map((x) => x.id),
      )
      .order("position");
    if (l.error) throw l.error;
    lines = (l.data ?? []).map((x) => ({
      ...x,
      quantity: num(x.quantity),
      unit_price_cents: num(x.unit_price_cents),
      catalog_unit_price_cents:
        x.catalog_unit_price_cents === null ? null : num(x.catalog_unit_price_cents),
      discount_value: x.discount_value === null ? null : num(x.discount_value),
      line_subtotal_cents: num(x.line_subtotal_cents),
      discount_cents: num(x.discount_cents),
      line_total_cents: num(x.line_total_cents),
    })) as Line[];
  }
  return {
    estimates,
    lines,
    invoices: (i.data ?? []).map((x) => ({ ...x, total_cents: num(x.total_cents) })) as Invoice[],
    payments: (p.data ?? []).map((x) => ({ ...x, amount_cents: num(x.amount_cents) })) as Payment[],
  };
}

/**
 * What the customer owes: the live invoice if there is one, else the current
 * estimate (approved or not). Deposits and payments reduce it, refunds add back.
 */
export function balance(data: MoneyData): {
  due: number;
  paid: number;
  balance: number;
  basis: "invoice" | "estimate" | "none";
} {
  const invoice = data.invoices.find((i) => !i.voided_at);
  const current = data.estimates.find((e) => e.status !== "superseded");
  const due = invoice?.total_cents ?? current?.total_cents ?? 0;
  const paid = data.payments.reduce(
    (s, p) => s + (p.kind === "refund" ? -p.amount_cents : p.amount_cents),
    0,
  );
  return {
    due,
    paid,
    balance: due - paid,
    basis: invoice ? "invoice" : current ? "estimate" : "none",
  };
}

export function lineDiscountText(l: Line, formatMoney: (c: number) => string): string | null {
  if (!l.discount_type || l.discount_value === null) return null;
  return l.discount_type === "percent"
    ? `${l.discount_value}% off`
    : `${formatMoney(Math.round(l.discount_value * 100))} off`;
}

export function quantityText(l: Pick<Line, "quantity" | "unit_snapshot">): string {
  const q = Number.isInteger(l.quantity) ? String(l.quantity) : l.quantity.toFixed(2);
  return l.unit_snapshot === "hour" ? `${q} h` : q;
}
