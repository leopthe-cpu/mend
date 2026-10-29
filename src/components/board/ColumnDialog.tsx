import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, ChevronDown, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Field, selectClass } from "@/components/app/Field";
import { FormAlert } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { TokenEditor } from "@/components/messages/TokenEditor";
import { parseTemplate, toTemplate } from "@/lib/messageTokens";
import { fieldLabel, MESSAGE_FIELDS } from "@/lib/messages";
import { friendlyDbError } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
import { STATUS_COLOR_CLASS, STATUS_COLORS, type Status, type StatusColor } from "@/lib/tickets";
import { cn } from "@/lib/utils";

// The column window (Oz, 29 Oct; decision 145): opened from a column's
// header on the board, for Owner and Admin. Replaces Settings › Board.

export type ColumnRequest = { kind: "edit"; status: Status } | { kind: "new"; after: Status };

const COLOR_NAMES: Record<StatusColor, string> = {
  received: "Slate",
  "in-progress": "Blue",
  teal: "Teal",
  ready: "Green",
  waiting: "Ochre",
  orange: "Orange",
  red: "Red",
  pink: "Pink",
  closed: "Grey",
};

// Oz's default column message (29 Oct); staff can change it before sending.
const DEFAULT_SUBJECT = "Update on your {item_name}";
const DEFAULT_BODY =
  "Hi {customer_first_name}, your {item_name} is now {status_name} and on track for pickup on {promised_date}. We'll let you know if anything changes.";

type Template = { id: string; channel: "sms" | "email"; subject: string | null; body: string };

export function ColumnDialog({
  request,
  shopId,
  statuses,
  counts,
  onClose,
  onSaved,
  onMove,
}: {
  request: ColumnRequest | null;
  shopId: string;
  statuses: Status[];
  /** Tickets per column, for the delete and finished prompts. */
  counts: Map<string, number>;
  onClose: () => void;
  onSaved: () => void;
  /** Move the column one place (the keyboard way to reorder; dragging is the other). */
  onMove: (statusId: string, dir: -1 | 1) => void;
}) {
  const editing = request?.kind === "edit" ? request.status : null;
  const finishedNow = statuses.find((s) => s.is_final);
  const [name, setName] = useState("");
  const [color, setColor] = useState<StatusColor>("in-progress");
  const [notify, setNotify] = useState(false);
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [body, setBody] = useState(DEFAULT_BODY);
  // Bumped when saved templates arrive, so the editors show them.
  const [loaded, setLoaded] = useState(0);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [idleOn, setIdleOn] = useState(true);
  const [idleDays, setIdleDays] = useState(2);
  const [dueOn, setDueOn] = useState(true);
  const [dueDays, setDueDays] = useState(2);
  const [finished, setFinished] = useState(false);
  const [more, setMore] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [moveTo, setMoveTo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!request) return;
    const s = request.kind === "edit" ? request.status : null;
    setName(s?.name ?? "");
    setColor(s?.color ?? "in-progress");
    setNotify(s?.notify_by_default ?? false);
    setIdleOn(s ? s.idle_alert_days !== null : true);
    setIdleDays(s?.idle_alert_days ?? 2);
    setDueOn(s ? s.due_alert_days !== null : true);
    setDueDays(s?.due_alert_days ?? 2);
    setFinished(!!s?.is_final);
    // More options open by themselves on the finished column, and when a
    // column is added after it (it may want to take over).
    setMore(!!s?.is_final || (request.kind === "new" && request.after.is_final));
    setDeleting(false);
    setMoveTo("");
    setError(null);
    setSubject(DEFAULT_SUBJECT);
    setBody(DEFAULT_BODY);
    setTemplates([]);
    if (!s) return;
    let alive = true;
    void getSupabase()
      .from("message_templates")
      .select("id, channel, subject, body")
      .eq("kind", "status")
      .eq("status_id", s.id)
      .then(({ data }) => {
        if (!alive) return;
        const rows = (data ?? []) as Template[];
        setTemplates(rows);
        const email = rows.find((r) => r.channel === "email");
        const sms = rows.find((r) => r.channel === "sms");
        if (email?.subject) setSubject(email.subject);
        if (email?.body || sms?.body) setBody(email?.body ?? sms?.body ?? DEFAULT_BODY);
        setLoaded((n) => n + 1);
      });
    return () => {
      alive = false;
    };
  }, [request]);

  if (!request) return null;
  const here = editing ? (counts.get(editing.id) ?? 0) : 0;
  const finishedTickets = finishedNow ? (counts.get(finishedNow.id) ?? 0) : 0;
  const becomingFinished = finished && !editing?.is_final;

  async function saveTemplates(statusId: string) {
    if (!notify || !body.trim()) return;
    const db = getSupabase().from("message_templates");
    // One message for both channels; the subject is for emails only.
    for (const channel of ["sms", "email"] as const) {
      const row = {
        body: body.trim(),
        subject: channel === "email" ? subject.trim() || null : null,
      };
      const existing = templates.find((t) => t.channel === channel);
      const { error } = existing
        ? await db.update(row).eq("id", existing.id).select("id")
        : await db
            .insert({ ...row, shop_id: shopId, kind: "status", status_id: statusId, channel })
            .select("id");
      if (error) throw error;
    }
  }

  async function save() {
    if (!name.trim()) return setError("Give the column a name.");
    setSaving(true);
    setError(null);
    try {
      const alerts = {
        idle_alert_days: idleOn && !finished ? clampDays(idleDays) : null,
        due_alert_days: dueOn && !finished ? clampDays(dueDays) : null,
      };
      let id: string;
      if (request?.kind === "new") {
        const { data, error } = await getSupabase().rpc("add_status", {
          p_shop_id: shopId,
          p_after: request.after.id,
          p_name: name.trim(),
          p_color: color,
          p_notify: notify,
          p_idle_days: alerts.idle_alert_days,
          p_due_days: alerts.due_alert_days,
        });
        if (error) throw error;
        id = data as string;
      } else {
        id = editing!.id;
        const { error } = await getSupabase()
          .from("statuses")
          .update({ name: name.trim(), color, notify_by_default: notify, ...alerts })
          .eq("id", id)
          .select("id");
        if (error) throw error;
      }
      await saveTemplates(id);
      if (becomingFinished) {
        const { error } = await getSupabase().rpc("set_finished_status", { p_status_id: id });
        if (error) throw error;
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(friendlyDbError(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editing) return;
    setSaving(true);
    setError(null);
    const { error } = await getSupabase().rpc("delete_status", {
      p_status_id: editing.id,
      p_move_to: here ? moveTo || null : null,
    });
    setSaving(false);
    if (error) return setError(friendlyDbError(error));
    onSaved();
    onClose();
  }

  const others = statuses.filter((s) => s.id !== editing?.id);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto bg-background text-foreground sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            {editing
              ? editing.name
              : `New column after ${request.kind === "new" ? request.after.name : ""}`}
          </DialogTitle>
          <DialogDescription>
            {editing ? (
              <>
                {here} ticket{here === 1 ? "" : "s"} ·{" "}
                <Link
                  to="/app/tickets"
                  search={{ f: `status:${editing.id}` }}
                  onClick={onClose}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  See all in the list
                </Link>
              </>
            ) : (
              "Name it, pick a colour, and decide whether customers hear about it."
            )}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field id="col-name" label="Name">
            <Input
              id="col-name"
              value={name}
              maxLength={60}
              autoFocus={!editing}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Colour</legend>
            <div className="flex flex-wrap gap-1">
              {STATUS_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={color === c}
                  aria-label={COLOR_NAMES[c]}
                  title={COLOR_NAMES[c]}
                  onClick={() => setColor(c)}
                  className={cn(
                    "flex size-11 items-center justify-center rounded-full",
                    color === c && "ring-2 ring-foreground",
                  )}
                >
                  <span className={cn("size-6 rounded-full", STATUS_COLOR_CLASS[c])} />
                </button>
              ))}
            </div>
          </fieldset>

          <div className="rounded-xl border border-border bg-card">
            <SwitchRow
              id="col-notify"
              label="Message customer on arrival"
              checked={notify}
              onChange={setNotify}
            />
            {notify ? (
              <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
                <div className="flex flex-col gap-2">
                  <span id="col-subject-label" className="text-sm font-medium">
                    Subject (emails only)
                  </span>
                  <TokenEditor
                    id="col-subject"
                    labelId="col-subject-label"
                    singleLine
                    value={parseTemplate(subject, fieldLabel)}
                    resetKey={`${request.kind}-${editing?.id ?? ""}-${loaded}`}
                    options={MESSAGE_FIELDS}
                    onChange={(segs) => setSubject(toTemplate(segs))}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <span id="col-body-label" className="text-sm font-medium">
                    Message
                  </span>
                  <TokenEditor
                    id="col-body"
                    labelId="col-body-label"
                    value={parseTemplate(body, fieldLabel)}
                    resetKey={`${request.kind}-${editing?.id ?? ""}-${loaded}`}
                    options={MESSAGE_FIELDS}
                    onChange={(segs) => setBody(toTemplate(segs))}
                  />
                  <p className="text-sm text-muted-foreground">
                    The + by your cursor adds a detail from the ticket. Mend opens this ready to
                    send when a ticket arrives here; staff can change it first.
                  </p>
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border border-border bg-card">
            <button
              type="button"
              aria-expanded={more}
              onClick={() => setMore((m) => !m)}
              className="flex min-h-11 w-full cursor-pointer items-center justify-between px-4 font-medium"
            >
              More options
              <ChevronDown
                aria-hidden
                className={cn("size-4 transition-transform", more && "rotate-180")}
              />
            </button>
            {more ? (
              <>
                {!finished ? (
                  <>
                    <DaysRow
                      id="col-idle"
                      label="Alert when idle for"
                      on={idleOn}
                      days={idleDays}
                      onToggle={setIdleOn}
                      onDays={setIdleDays}
                    />
                    <DaysRow
                      id="col-due"
                      label="Alert when due within"
                      on={dueOn}
                      days={dueDays}
                      onToggle={setDueOn}
                      onDays={setDueDays}
                    />
                  </>
                ) : null}
                {editing ? (
                  <div className="flex min-h-11 flex-wrap items-center gap-2 border-t border-border px-4 py-2">
                    <span className="flex-1">Position</span>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={statuses[0]?.id === editing.id}
                      onClick={() => onMove(editing.id, -1)}
                    >
                      <ArrowLeft aria-hidden /> Move left
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={statuses[statuses.length - 1]?.id === editing.id}
                      onClick={() => onMove(editing.id, 1)}
                    >
                      Move right <ArrowRight aria-hidden />
                    </Button>
                  </div>
                ) : null}
                <div className="border-t border-border">
                  <SwitchRow
                    id="col-finished"
                    label="Finished column"
                    hint={
                      editing?.is_final
                        ? "Tickets here are done. To change it, turn this on in another column."
                        : finished
                          ? `${finishedNow ? `${finishedNow.name}'s ${finishedTickets} finished ticket${finishedTickets === 1 ? "" : "s"} move here` : "Finished tickets go here"}${here ? `, and this column's ${here} ticket${here === 1 ? " is" : "s are"} marked picked up (passcodes deleted)` : ""}.`
                          : "Tickets here are done."
                    }
                    checked={finished}
                    disabled={!!editing?.is_final}
                    onChange={setFinished}
                  />
                </div>
              </>
            ) : null}
          </div>

          {deleting && editing ? (
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
              <p className="font-medium">
                {here
                  ? `Move ${editing.name}'s ${here} ticket${here === 1 ? "" : "s"} first`
                  : `Delete ${editing.name}?`}
              </p>
              {here ? (
                <Field id="col-move" label="Move them to">
                  <select
                    id="col-move"
                    className={selectClass}
                    value={moveTo}
                    onChange={(e) => setMoveTo(e.target.value)}
                  >
                    <option value="">Choose a column</option>
                    {others.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={() => setDeleting(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={saving || (!!here && !moveTo)}
                  onClick={() => void remove()}
                >
                  {here ? "Move and delete" : "Delete"}
                </Button>
              </div>
            </div>
          ) : null}

          {error ? <FormAlert tone="error">{error}</FormAlert> : null}
          <div className="flex flex-wrap items-center gap-3">
            {editing && !editing.is_final && !deleting ? (
              <button
                type="button"
                onClick={() => setDeleting(true)}
                className="mr-auto inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full px-2 font-medium text-danger hover:bg-card"
              >
                <Trash2 aria-hidden className="size-4" /> Delete column
              </button>
            ) : (
              <span className="mr-auto" />
            )}
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : editing ? "Save" : "Add column"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function clampDays(n: number): number {
  return Math.min(60, Math.max(1, Math.round(n) || 1));
}

/** A label on the left, the switch on the right (Oz, 29 Oct); the whole row is the target. */
function SwitchRow({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex min-h-11 items-center gap-3 px-4 py-2.5",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
      )}
    >
      <span className="flex flex-1 flex-col">
        <span className="font-medium">{label}</span>
        {hint ? <span className="text-sm text-muted-foreground">{hint}</span> : null}
      </span>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </label>
  );
}

function DaysRow({
  id,
  label,
  on,
  days,
  onToggle,
  onDays,
}: {
  id: string;
  label: string;
  on: boolean;
  days: number;
  onToggle: (v: boolean) => void;
  onDays: (n: number) => void;
}) {
  return (
    <div className="flex min-h-11 items-center gap-3 border-t border-border px-4 py-2">
      <span className="flex flex-1 flex-wrap items-center gap-2">
        <label htmlFor={`${id}-days`}>{label}</label>
        <Input
          id={`${id}-days`}
          type="number"
          inputMode="numeric"
          min={1}
          max={60}
          disabled={!on}
          value={days}
          onChange={(e) => onDays(Number(e.target.value))}
          className="h-10 w-16 text-center"
        />
        <span>days</span>
      </span>
      <Switch id={id} aria-label={label} checked={on} onCheckedChange={onToggle} />
    </div>
  );
}
