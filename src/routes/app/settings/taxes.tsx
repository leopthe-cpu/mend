import { createFileRoute } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Field, Panel } from "@/components/app/Field";
import { FormAlert } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchTaxRates, type TaxRate } from "@/lib/money";
import { friendlyDbError, roleAtLeast } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";

export const Route = createFileRoute("/app/settings/taxes")({
  component: TaxSettings,
});

type Msg = { tone: "error" | "info"; text: string } | null;

// Rates are typed by the shop: tax rules change and differ by province/state,
// so Mend doesn't ship numbers it can't keep current (decision 28).
const RATE_RE = /^\d{1,2}(\.\d{1,3})?$|^100(\.0{1,3})?$/;

function TaxSettings() {
  const { membership } = Route.useRouteContext();
  const shopId = membership.shop.id;
  const canEdit = roleAtLeast(membership.role, "admin");
  const [rates, setRates] = useState<TaxRate[] | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");

  const load = useCallback(async () => {
    try {
      setRates(await fetchTaxRates(shopId));
    } catch (e) {
      setMsg({ tone: "error", text: friendlyDbError(e) });
    }
  }, [shopId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(
    write: () => PromiseLike<{ data: unknown[] | null; error: unknown }>,
    ok: string,
  ): Promise<boolean> {
    setMsg(null);
    const { data, error } = await write();
    if (error || !data?.length) {
      setMsg({
        tone: "error",
        text: error
          ? friendlyDbError(error)
          : "You don't have permission to change these settings.",
      });
      return false;
    }
    setMsg({ tone: "info", text: ok });
    await load();
    return true;
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {!canEdit ? (
        <FormAlert tone="info">Only the Owner and Admins can change taxes.</FormAlert>
      ) : null}
      {msg ? <FormAlert tone={msg.tone}>{msg.text}</FormAlert> : null}
      <Panel
        title="Tax rates"
        description="Enter the rates you charge, e.g. HST 13 or GST 5 and PST 7. Check current rates with your accountant or tax authority. Changing a rate affects new estimate lines only."
      >
        {rates === null ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : rates.length === 0 ? (
          <p className="text-muted-foreground">No tax rates yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {rates.map((r) => (
              <RateRow
                key={r.id}
                rate={r}
                canEdit={canEdit}
                onSave={(patch) =>
                  run(
                    () => getSupabase().from("tax_rates").update(patch).eq("id", r.id).select("id"),
                    `${patch.name ?? r.name} saved.`,
                  )
                }
                onDelete={() => {
                  if (
                    window.confirm(
                      `Delete ${r.name}? Catalog items stop charging it. Estimates already made keep it. To pause it instead, untick "In use".`,
                    )
                  )
                    void run(
                      () => getSupabase().from("tax_rates").delete().eq("id", r.id).select("id"),
                      `${r.name} deleted.`,
                    );
                }}
              />
            ))}
          </ul>
        )}
        {canEdit ? (
          <form
            method="post"
            className="mt-6 grid gap-4 rounded-md border border-dashed border-border p-4 sm:grid-cols-[1fr_8rem_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return setMsg({ tone: "error", text: "Name the tax, e.g. HST." });
              if (!RATE_RE.test(rate.trim()))
                return setMsg({ tone: "error", text: "Enter the rate in percent, e.g. 13." });
              void run(
                () =>
                  getSupabase()
                    .from("tax_rates")
                    .insert({ shop_id: shopId, name: name.trim(), rate: Number(rate) })
                    .select("id"),
                `${name.trim()} added.`,
              ).then((ok) => {
                if (ok) {
                  setName("");
                  setRate("");
                }
              });
            }}
          >
            <Field id="nt-name" label="Name">
              <Input
                id="nt-name"
                value={name}
                maxLength={40}
                placeholder="HST"
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field id="nt-rate" label="Rate (%)">
              <Input
                id="nt-rate"
                inputMode="decimal"
                value={rate}
                placeholder="13"
                onChange={(e) => setRate(e.target.value)}
              />
            </Field>
            <Button type="submit">
              <Plus /> Add tax
            </Button>
          </form>
        ) : null}
      </Panel>
    </div>
  );
}

function RateRow({
  rate,
  canEdit,
  onSave,
  onDelete,
}: {
  rate: TaxRate;
  canEdit: boolean;
  onSave: (patch: { name?: string; rate?: number; active?: boolean }) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [name, setName] = useState(rate.name);
  const [value, setValue] = useState(String(rate.rate));
  const [err, setErr] = useState<string | null>(null);
  const dirty = name !== rate.name || Number(value) !== rate.rate;
  const id = `tx-${rate.id}`;

  return (
    <li className="rounded-md border border-border p-4">
      <form
        method="post"
        className="grid gap-4 sm:grid-cols-[1fr_8rem_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return setErr("Name the tax.");
          if (!RATE_RE.test(value.trim())) return setErr("Enter the rate in percent, e.g. 13.");
          setErr(null);
          void onSave({ name: name.trim(), rate: Number(value) });
        }}
      >
        <fieldset disabled={!canEdit} className="contents">
          <Field id={`${id}-name`} label="Name">
            <Input
              id={`${id}-name`}
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field id={`${id}-rate`} label="Rate (%)">
            <Input
              id={`${id}-rate`}
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </Field>
          <div className="flex items-center gap-1">
            <label className="flex min-h-11 items-center gap-2 pr-2">
              <input
                type="checkbox"
                className="size-5"
                checked={rate.active}
                onChange={(e) => void onSave({ active: e.target.checked })}
              />
              In use
            </label>
            {canEdit ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Delete ${rate.name}`}
                onClick={onDelete}
              >
                <Trash2 />
              </Button>
            ) : null}
          </div>
        </fieldset>
        {err ? <p className="text-danger sm:col-span-3">{err}</p> : null}
        {canEdit && dirty ? (
          <div className="sm:col-span-3">
            <Button type="submit">Save tax</Button>
          </div>
        ) : null}
      </form>
    </li>
  );
}
