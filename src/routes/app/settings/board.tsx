import { createFileRoute } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { FormAlert } from "@/components/auth/AuthLayout";
import { Field, Panel, selectClass } from "@/components/app/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { friendlyDbError, roleAtLeast } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
import {
  type CustomField,
  fetchCustomFields,
  fetchStatuses,
  type Status,
  STATUS_COLOR_CLASS,
  type StatusCategory,
} from "@/lib/tickets";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/settings/board")({
  component: BoardSettings,
});

const CATEGORIES: { value: StatusCategory; label: string }[] = [
  { value: "open", label: "Open (being worked on)" },
  { value: "waiting", label: "Waiting (parts, approval)" },
  { value: "ready", label: "Ready for pickup" },
  { value: "closed", label: "Closed" },
];
const COLORS: { value: Status["color"]; label: string }[] = [
  { value: "received", label: "Received" },
  { value: "in-progress", label: "In progress" },
  { value: "waiting", label: "Waiting" },
  { value: "ready", label: "Ready" },
  { value: "closed", label: "Closed" },
];
const FIELD_TYPES: { value: CustomField["field_type"]; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "select", label: "Choice list" },
];

type Msg = { tone: "error" | "info"; text: string } | null;

function BoardSettings() {
  const { membership } = Route.useRouteContext();
  const shopId = membership.shop.id;
  const canEdit = roleAtLeast(membership.role, "admin");
  const [statuses, setStatuses] = useState<Status[] | null>(null);
  const [fields, setFields] = useState<CustomField[] | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  const load = useCallback(async () => {
    try {
      const [s, f] = await Promise.all([fetchStatuses(shopId), fetchCustomFields(shopId)]);
      setStatuses(s);
      setFields(f);
    } catch (e) {
      setMsg({ tone: "error", text: friendlyDbError(e) });
    }
  }, [shopId]);
  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Runs a write and reports it. RLS turns a forbidden update/delete into
   * "0 rows" rather than an error, so callers return the affected rows and an
   * empty result is reported as a permission problem.
   */
  async function run(
    write: () => PromiseLike<{ data: unknown[] | null; error: unknown }>,
    ok: string,
  ): Promise<boolean> {
    setMsg(null);
    const { data, error } = await write();
    if (error) {
      setMsg({ tone: "error", text: friendlyDbError(error) });
      return false;
    }
    if (!data?.length) {
      setMsg({ tone: "error", text: "You don't have permission to change these settings." });
      return false;
    }
    setMsg({ tone: "info", text: ok });
    await load();
    return true;
  }

  /** Swap positions with the neighbour; two updates, then reload. */
  async function move(
    table: "statuses" | "custom_field_definitions",
    list: { id: string; position: number }[],
    i: number,
    dir: -1 | 1,
  ) {
    const a = list[i];
    const b = list[i + dir];
    if (!a || !b) return;
    const db = getSupabase();
    // Positions aren't unique, so a plain swap is safe even if both match.
    const pa = b.position === a.position ? a.position + dir : b.position;
    await run(async () => {
      const r1 = await db.from(table).update({ position: pa }).eq("id", a.id).select("id");
      if (r1.error || !r1.data?.length) return r1;
      return db.from(table).update({ position: a.position }).eq("id", b.id).select("id");
    }, "Order saved.");
  }

  const nextPos = (list: { position: number }[]) =>
    list.reduce((m, x) => Math.max(m, x.position), 0) + 1;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {!canEdit ? (
        <FormAlert tone="info">Only the Owner and Admins can change the board setup.</FormAlert>
      ) : null}
      {msg ? <FormAlert tone={msg.tone}>{msg.text}</FormAlert> : null}

      <Panel
        title="Board statuses"
        description="The columns on your board, left to right. New tickets start in the first one. The picked-up status closes a ticket and can be renamed but not removed."
      >
        {statuses === null ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {statuses.map((s, i) => (
              <StatusRow
                key={s.id}
                status={s}
                canEdit={canEdit}
                first={i === 0}
                last={i === statuses.length - 1}
                onMove={(dir) => void move("statuses", statuses, i, dir)}
                onSave={(patch) =>
                  run(
                    () => getSupabase().from("statuses").update(patch).eq("id", s.id).select("id"),
                    "Status saved.",
                  )
                }
                onDelete={() => {
                  if (window.confirm(`Delete the status "${s.name}"?`))
                    void run(
                      () => getSupabase().from("statuses").delete().eq("id", s.id).select("id"),
                      "Status deleted.",
                    );
                }}
              />
            ))}
          </ul>
        )}
        {canEdit && statuses ? (
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            onClick={() =>
              void run(
                () =>
                  getSupabase()
                    .from("statuses")
                    .insert({
                      shop_id: shopId,
                      name: "New status",
                      category: "open",
                      color: "in-progress",
                      position: nextPos(statuses),
                    })
                    .select("id"),
                "Status added. Rename it and move it into place.",
              )
            }
          >
            <Plus /> Add status
          </Button>
        ) : null}
      </Panel>

      <Panel
        title="Ticket fields"
        description="Extra details you record on every ticket, like IMEI, ski length or frame size. A field's type can't change after it's created; delete it and add a new one instead."
      >
        {fields === null ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : fields.length === 0 ? (
          <p className="text-muted-foreground">No extra fields yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {fields.map((f, i) => (
              <FieldRow
                key={f.id}
                field={f}
                canEdit={canEdit}
                first={i === 0}
                last={i === fields.length - 1}
                onMove={(dir) => void move("custom_field_definitions", fields, i, dir)}
                onSave={(patch) =>
                  run(
                    () =>
                      getSupabase()
                        .from("custom_field_definitions")
                        .update(patch)
                        .eq("id", f.id)
                        .select("id"),
                    "Field saved.",
                  )
                }
                onDelete={() => {
                  if (
                    window.confirm(
                      `Delete the field "${f.label}"? Values already on tickets stay in the audit log but are no longer shown.`,
                    )
                  )
                    void run(
                      () =>
                        getSupabase()
                          .from("custom_field_definitions")
                          .delete()
                          .eq("id", f.id)
                          .select("id"),
                      "Field deleted.",
                    );
                }}
              />
            ))}
          </ul>
        )}
        {canEdit && fields ? (
          <NewField
            onAdd={(row) =>
              run(
                () =>
                  getSupabase()
                    .from("custom_field_definitions")
                    .insert({ ...row, shop_id: shopId, position: nextPos(fields) })
                    .select("id"),
                "Field added.",
              )
            }
          />
        ) : null}
      </Panel>
    </div>
  );
}

function RowShell({
  children,
  canEdit,
  first,
  last,
  onMove,
  onDelete,
  deletable,
  label,
}: {
  children: React.ReactNode;
  canEdit: boolean;
  first: boolean;
  last: boolean;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
  deletable: boolean;
  label: string;
}) {
  return (
    <li className="flex flex-col gap-3 rounded-md border border-border p-4 sm:flex-row sm:items-start">
      <div className="flex-1">{children}</div>
      {canEdit ? (
        <div className="flex gap-1 sm:flex-col">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={first}
            onClick={() => onMove(-1)}
            aria-label={`Move ${label} up`}
          >
            <ArrowUp />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={last}
            onClick={() => onMove(1)}
            aria-label={`Move ${label} down`}
          >
            <ArrowDown />
          </Button>
          {deletable ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onDelete}
              aria-label={`Delete ${label}`}
            >
              <Trash2 />
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function StatusRow({
  status,
  canEdit,
  first,
  last,
  onMove,
  onSave,
  onDelete,
}: {
  status: Status;
  canEdit: boolean;
  first: boolean;
  last: boolean;
  onMove: (dir: -1 | 1) => void;
  onSave: (patch: Partial<Status>) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [form, setForm] = useState({
    name: status.name,
    category: status.category,
    color: status.color,
    notify_by_default: status.notify_by_default,
  });
  const dirty =
    form.name !== status.name ||
    form.category !== status.category ||
    form.color !== status.color ||
    form.notify_by_default !== status.notify_by_default;
  const id = `st-${status.id}`;

  return (
    <RowShell
      canEdit={canEdit}
      first={first}
      last={last}
      onMove={onMove}
      onDelete={onDelete}
      deletable={!status.is_final}
      label={status.name}
    >
      <form
        method="post"
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.name.trim()) return;
          void onSave({ ...form, name: form.name.trim() });
        }}
      >
        <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
          <Field id={`${id}-name`} label={status.is_final ? "Name (picked up)" : "Name"}>
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className={cn("size-3 shrink-0 rounded-full", STATUS_COLOR_CLASS[form.color])}
              />
              <Input
                id={`${id}-name`}
                value={form.name}
                maxLength={60}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
          </Field>
          <Field id={`${id}-color`} label="Colour">
            <select
              id={`${id}-color`}
              className={selectClass}
              value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value as Status["color"] })}
            >
              {COLORS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${id}-cat`} label="Kind" hint="Ready and Closed stop the overdue warning.">
            <select
              id={`${id}-cat`}
              className={selectClass}
              value={form.category}
              disabled={status.is_final}
              onChange={(e) => setForm({ ...form, category: e.target.value as StatusCategory })}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex min-h-11 items-center gap-3 self-center">
            <input
              type="checkbox"
              className="size-5"
              checked={form.notify_by_default}
              onChange={(e) => setForm({ ...form, notify_by_default: e.target.checked })}
            />
            Notify the customer by default
          </label>
        </fieldset>
        {canEdit && dirty ? (
          <Button type="submit" className="mt-4">
            Save status
          </Button>
        ) : null}
      </form>
    </RowShell>
  );
}

function parseOptions(text: string): string[] {
  return [
    ...new Set(
      text
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  ];
}

function FieldRow({
  field,
  canEdit,
  first,
  last,
  onMove,
  onSave,
  onDelete,
}: {
  field: CustomField;
  canEdit: boolean;
  first: boolean;
  last: boolean;
  onMove: (dir: -1 | 1) => void;
  onSave: (patch: Partial<CustomField>) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [form, setForm] = useState({
    label: field.label,
    options: field.options.join(", "),
    required: field.required,
    help_text: field.help_text ?? "",
  });
  const dirty =
    form.label !== field.label ||
    form.options !== field.options.join(", ") ||
    form.required !== field.required ||
    form.help_text !== (field.help_text ?? "");
  const id = `cf-${field.id}`;
  const [err, setErr] = useState<string | null>(null);

  return (
    <RowShell
      canEdit={canEdit}
      first={first}
      last={last}
      onMove={onMove}
      onDelete={onDelete}
      deletable
      label={field.label}
    >
      <form
        method="post"
        onSubmit={(e) => {
          e.preventDefault();
          const options = parseOptions(form.options);
          if (!form.label.trim()) return setErr("The field needs a name.");
          if (field.field_type === "select" && options.length === 0)
            return setErr("Add at least one choice, separated by commas.");
          setErr(null);
          void onSave({
            label: form.label.trim(),
            required: form.required,
            help_text: form.help_text.trim() || null,
            ...(field.field_type === "select" ? { options } : {}),
          });
        }}
      >
        <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
          <Field id={`${id}-label`} label="Name">
            <Input
              id={`${id}-label`}
              value={form.label}
              maxLength={60}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
          </Field>
          <Field id={`${id}-type`} label="Type">
            <Input
              id={`${id}-type`}
              value={FIELD_TYPES.find((t) => t.value === field.field_type)?.label ?? ""}
              readOnly
              disabled
            />
          </Field>
          {field.field_type === "select" ? (
            <div className="sm:col-span-2">
              <Field
                id={`${id}-opts`}
                label="Choices"
                hint="Separate with commas. Removing a choice keeps it on tickets that already have it."
              >
                <Input
                  id={`${id}-opts`}
                  value={form.options}
                  maxLength={2000}
                  onChange={(e) => setForm({ ...form, options: e.target.value })}
                />
              </Field>
            </div>
          ) : null}
          <Field id={`${id}-help`} label="Hint (optional)">
            <Input
              id={`${id}-help`}
              value={form.help_text}
              maxLength={300}
              onChange={(e) => setForm({ ...form, help_text: e.target.value })}
            />
          </Field>
          <label className="flex min-h-11 items-center gap-3 self-end">
            <input
              type="checkbox"
              className="size-5"
              checked={form.required}
              onChange={(e) => setForm({ ...form, required: e.target.checked })}
            />
            Required on new tickets
          </label>
        </fieldset>
        {err ? <p className="mt-3 text-danger">{err}</p> : null}
        {canEdit && dirty ? (
          <Button type="submit" className="mt-4">
            Save field
          </Button>
        ) : null}
      </form>
    </RowShell>
  );
}

function NewField({
  onAdd,
}: {
  onAdd: (row: {
    label: string;
    field_type: CustomField["field_type"];
    options: string[];
    required: boolean;
  }) => Promise<boolean>;
}) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState<CustomField["field_type"]>("text");
  const [options, setOptions] = useState("");
  const [err, setErr] = useState<string | null>(null);

  return (
    <form
      method="post"
      className="mt-6 grid gap-4 rounded-md border border-dashed border-border p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const opts = parseOptions(options);
        if (!label.trim()) return setErr("Give the field a name.");
        if (type === "select" && opts.length === 0)
          return setErr("Add at least one choice, separated by commas.");
        setErr(null);
        void onAdd({
          label: label.trim(),
          field_type: type,
          options: type === "select" ? opts : [],
          required: false,
        }).then((ok) => {
          if (ok) {
            setLabel("");
            setOptions("");
            setType("text");
          }
        });
      }}
    >
      <h3 className="text-lg font-semibold sm:col-span-2">Add a field</h3>
      <Field id="nf-label" label="Name">
        <Input
          id="nf-label"
          value={label}
          maxLength={60}
          placeholder="IMEI"
          onChange={(e) => setLabel(e.target.value)}
        />
      </Field>
      <Field id="nf-type" label="Type">
        <select
          id="nf-type"
          className={selectClass}
          value={type}
          onChange={(e) => setType(e.target.value as CustomField["field_type"])}
        >
          {FIELD_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      {type === "select" ? (
        <div className="sm:col-span-2">
          <Field id="nf-opts" label="Choices" hint="Separate with commas.">
            <Input
              id="nf-opts"
              value={options}
              maxLength={2000}
              placeholder="Phone, Tablet, Laptop"
              onChange={(e) => setOptions(e.target.value)}
            />
          </Field>
        </div>
      ) : null}
      {err ? <p className="text-danger sm:col-span-2">{err}</p> : null}
      <div className="sm:col-span-2">
        <Button type="submit">
          <Plus /> Add field
        </Button>
      </div>
    </form>
  );
}
