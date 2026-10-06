import { describe, expect, it } from "vitest";

import { balance, type MoneyData } from "./estimates";

const base = (over: Partial<MoneyData>): MoneyData => ({
  estimates: [],
  lines: [],
  invoices: [],
  payments: [],
  ...over,
});
const est = (id: string, status: string, total: number) =>
  ({ id, status, total_cents: total }) as unknown as MoneyData["estimates"][number];
const pay = (kind: string, amount: number) =>
  ({ id: kind + amount, kind, amount_cents: amount }) as unknown as MoneyData["payments"][number];

describe("balance", () => {
  it("uses the live invoice over the estimate", () => {
    const b = balance(
      base({
        estimates: [est("e2", "approved", 50000), est("e1", "superseded", 42601)],
        invoices: [
          { estimate_id: "e2", total_cents: 50000, voided_at: null },
          { estimate_id: "e1", total_cents: 42601, voided_at: "2026-10-06" },
        ] as unknown as MoneyData["invoices"],
      }),
    );
    expect(b).toEqual({ due: 50000, paid: 0, balance: 50000, basis: "invoice" });
  });

  it("subtracts deposits and payments and adds refunds back", () => {
    const b = balance(
      base({
        estimates: [est("e1", "draft", 42601)],
        payments: [pay("deposit", 10000), pay("payment", 32601), pay("refund", 1000)],
      }),
    );
    expect(b).toEqual({ due: 42601, paid: 41601, balance: 1000, basis: "estimate" });
  });

  it("is zero with nothing on the ticket", () => {
    expect(balance(base({}))).toEqual({ due: 0, paid: 0, balance: 0, basis: "none" });
  });
});
