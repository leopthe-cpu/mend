// Estimate and invoice PDFs, built in the browser with @react-pdf/renderer
// (decision 38). This module is imported lazily so the PDF engine only loads
// when someone downloads a PDF. Built-in Helvetica keeps it small and needs no
// font files; the layout follows Mend's style but leads with the shop's name.
/* eslint-disable react-refresh/only-export-components -- not a UI module; the
   PDF document component is internal and never hot-reloaded on screen. */
import { Document, Page, pdf, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { Estimate, Invoice, Line, Payment } from "@/lib/estimates";
import { APPROVAL_LABEL, KIND_LABEL, METHOD_LABEL, quantityText } from "@/lib/estimates";
import { formatMoney } from "@/lib/money";
import { shopToday } from "@/lib/tickets";

export type PdfInput = {
  kind: "estimate" | "invoice";
  shop: {
    name: string;
    address: string | null;
    phone: string | null;
    email: string | null;
    tax_registration_number: string | null;
    currency: string;
    terms_text?: string | null;
  };
  /** Shop time zone: every date on the document is the shop's calendar date. */
  timeZone: string;
  ticketNumber: number;
  itemName: string;
  customerName: string;
  estimate: Estimate;
  lines: Line[];
  invoice?: Invoice;
  payments?: Payment[];
};

const NAVY = "#101025";
const MUTED = "#55586B";
const RULE = "#D6D7E0";

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: NAVY },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  shopName: { fontSize: 18, fontFamily: "Helvetica-Bold" },
  muted: { color: MUTED },
  docTitle: { fontSize: 16, fontFamily: "Helvetica-Bold", textAlign: "right" },
  meta: { textAlign: "right", color: MUTED, marginTop: 2 },
  block: { marginBottom: 16 },
  label: { fontSize: 8, color: MUTED, textTransform: "uppercase", marginBottom: 2 },
  row: { flexDirection: "row", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: RULE },
  headRow: {
    flexDirection: "row",
    paddingBottom: 4,
    borderBottomWidth: 1.5,
    borderBottomColor: NAVY,
  },
  cItem: { flex: 1, paddingRight: 8 },
  cQty: { width: 44, textAlign: "right" },
  cPrice: { width: 80, textAlign: "right" },
  cTotal: { width: 80, textAlign: "right" },
  strike: { textDecoration: "line-through", color: MUTED },
  small: { fontSize: 8, color: MUTED },
  totals: { marginTop: 12, marginLeft: "auto", width: 220 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  grand: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 6,
    marginTop: 4,
    borderTopWidth: 1.5,
    borderTopColor: NAVY,
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
  },
  footer: { position: "absolute", bottom: 28, left: 40, right: 40, fontSize: 8, color: MUTED },
});

function Doc(p: PdfInput) {
  const money = (c: number) => formatMoney(c, p.shop.currency);
  const t = p.invoice ?? p.estimate;
  const paid = (p.payments ?? []).reduce(
    (sum, x) => sum + (x.kind === "refund" ? -x.amount_cents : x.amount_cents),
    0,
  );
  const title =
    p.kind === "invoice" && p.invoice
      ? `Invoice #${p.invoice.invoice_number}`
      : `Estimate v${p.estimate.version}`;
  const date = shopToday(p.timeZone, new Date(p.invoice?.issued_at ?? p.estimate.created_at));

  return (
    <Document title={`${p.shop.name} ${title}`} author={p.shop.name} creator="Mend">
      <Page size="LETTER" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.shopName}>{p.shop.name}</Text>
            {p.shop.address ? <Text style={s.muted}>{p.shop.address}</Text> : null}
            {p.shop.phone || p.shop.email ? (
              <Text style={s.muted}>
                {[p.shop.phone, p.shop.email].filter(Boolean).join(" · ")}
              </Text>
            ) : null}
            {p.shop.tax_registration_number ? (
              <Text style={s.muted}>Tax reg. no. {p.shop.tax_registration_number}</Text>
            ) : null}
          </View>
          <View>
            <Text style={s.docTitle}>{title}</Text>
            <Text style={s.meta}>{date}</Text>
            <Text style={s.meta}>Ticket #{p.ticketNumber}</Text>
          </View>
        </View>

        <View style={[s.block, { flexDirection: "row", gap: 32 }]}>
          <View>
            <Text style={s.label}>Customer</Text>
            <Text>{p.customerName}</Text>
          </View>
          <View>
            <Text style={s.label}>Item</Text>
            <Text>{p.itemName}</Text>
          </View>
          {p.kind === "estimate" && p.estimate.approved_at && p.estimate.approval_method ? (
            <View>
              <Text style={s.label}>Approved</Text>
              <Text>
                {shopToday(p.timeZone, new Date(p.estimate.approved_at))},{" "}
                {APPROVAL_LABEL[p.estimate.approval_method]}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={s.headRow}>
          <Text style={[s.cItem, s.label]}>Item</Text>
          <Text style={[s.cQty, s.label]}>Qty</Text>
          <Text style={[s.cPrice, s.label]}>Price</Text>
          <Text style={[s.cTotal, s.label]}>Total</Text>
        </View>
        {p.lines.map((l) => {
          const override =
            l.catalog_unit_price_cents !== null &&
            l.catalog_unit_price_cents !== l.unit_price_cents;
          return (
            <View key={l.id} style={s.row} wrap={false}>
              <View style={s.cItem}>
                <Text>{l.name_snapshot}</Text>
                {l.discount_type && l.discount_value !== null ? (
                  <Text style={s.small}>
                    {l.discount_type === "percent"
                      ? `${l.discount_value}% off`
                      : `${money(Math.round(l.discount_value * 100))} off`}
                    {l.discount_reason ? ` · ${l.discount_reason}` : ""}
                  </Text>
                ) : null}
              </View>
              <Text style={s.cQty}>{quantityText(l)}</Text>
              <View style={s.cPrice}>
                {override ? (
                  <Text style={s.strike}>{money(l.catalog_unit_price_cents ?? 0)}</Text>
                ) : null}
                <Text>{money(l.unit_price_cents)}</Text>
              </View>
              <View style={s.cTotal}>
                {l.discount_cents > 0 ? (
                  <Text style={s.strike}>{money(l.line_subtotal_cents)}</Text>
                ) : null}
                <Text>{money(l.line_total_cents)}</Text>
              </View>
            </View>
          );
        })}

        <View style={s.totals}>
          {t.savings_cents > 0 ? (
            <>
              <View style={s.totalRow}>
                <Text style={s.muted}>Before discounts</Text>
                <Text style={s.muted}>{money(t.subtotal_before_cents)}</Text>
              </View>
              <View style={s.totalRow}>
                <Text>Total savings</Text>
                <Text>-{money(t.savings_cents)}</Text>
              </View>
            </>
          ) : null}
          <View style={s.totalRow}>
            <Text>Subtotal</Text>
            <Text>{money(t.subtotal_cents)}</Text>
          </View>
          {t.tax_breakdown.map((x) => (
            <View key={x.id} style={s.totalRow}>
              <Text>
                {x.name} ({Number(x.rate)}%)
              </Text>
              <Text>{money(Number(x.tax_cents))}</Text>
            </View>
          ))}
          <View style={s.grand}>
            <Text>Total</Text>
            <Text>{money(t.total_cents)}</Text>
          </View>
          {p.kind === "invoice" && p.payments?.length ? (
            <>
              {p.payments.map((x) => (
                <View key={x.id} style={s.totalRow}>
                  <Text style={s.muted}>
                    {KIND_LABEL[x.kind]} · {METHOD_LABEL[x.method]} · {x.paid_on}
                  </Text>
                  <Text style={s.muted}>
                    {x.kind === "refund" ? "+" : "-"}
                    {money(x.amount_cents)}
                  </Text>
                </View>
              ))}
              <View style={s.grand}>
                <Text>Balance due</Text>
                <Text>{money(t.total_cents - paid)}</Text>
              </View>
            </>
          ) : null}
        </View>

        {p.kind === "estimate" && p.shop.terms_text ? (
          <View style={{ marginTop: 24 }}>
            <Text style={s.label}>Terms</Text>
            <Text style={s.small}>{p.shop.terms_text}</Text>
          </View>
        ) : null}

        <Text
          style={s.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            `${p.shop.name} · ${title} · Page ${pageNumber} of ${totalPages} · Made with Mend`
          }
        />
      </Page>
    </Document>
  );
}

export async function downloadPdf(input: PdfInput): Promise<void> {
  const blob = await pdf(<Doc {...input} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download =
    input.kind === "invoice" && input.invoice
      ? `invoice-${input.invoice.invoice_number}.pdf`
      : `estimate-${input.ticketNumber}-v${input.estimate.version}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before freeing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
