import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useUnsavedChanges } from "@/lib/unsaved";
import { Field, Panel } from "@/components/app/Field";
import { FormAlert } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  type Channel,
  type MessageKind,
  fetchTemplates,
  renderTemplate,
  smsSegments,
  type Template,
  type TemplateVars,
  VARIABLES,
} from "@/lib/messages";
import { friendlyDbError, roleAtLeast } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
import { nextOpenDays, pickupHoursText, promisedDateText } from "@/lib/hours";
import { fetchStatuses, shopToday, type Status } from "@/lib/tickets";

export const Route = createFileRoute("/app/settings/messages")({
  component: MessageSettings,
});

type Msg = { tone: "error" | "info"; text: string } | null;

function MessageSettings() {
  const { membership } = Route.useRouteContext();
  const shop = membership.shop;
  const canEdit = roleAtLeast(membership.role, "admin");
  const [statuses, setStatuses] = useState<Status[] | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [msg, setMsg] = useState<Msg>(null);

  const load = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([fetchStatuses(shop.id), fetchTemplates(shop.id)]);
      setStatuses(s);
      setTemplates(t);
    } catch (e) {
      setMsg({ tone: "error", text: friendlyDbError(e) });
    }
  }, [shop.id]);
  useEffect(() => {
    void load();
  }, [load]);

  // "Ticket ready" is the first Ready-group status by position (the one
  // insert_trade_seed gives a template); other statuses keep theirs below.
  const readyStatus = statuses?.find((s) => s.category === "ready");
  const otherStatuses = (statuses ?? []).filter((s) => s.id !== readyStatus?.id);
  const hours = shop.business_hours?.text?.trim() || "Mon-Fri 9-5";
  const sample: TemplateVars = useMemo(
    () => ({
      customer_first_name: "Maria",
      customer_name: "Maria Rossi",
      item_name: "winter coat",
      ticket_title: "winter coat",
      shop_name: shop.name,
      ticket_number: 1042,
      pickup_hours: pickupHoursText(shop.business_hours?.schedule, hours, shop.time_zone),
      shop_hours: hours,
      promised_date: promisedDateText(
        nextOpenDays(shop.business_hours?.schedule, shopToday(shop.time_zone), 3)[2] ??
          shopToday(shop.time_zone),
        shop.business_hours?.schedule,
      ),
      amount_due: "$100.00",
      payment_line: "Payment of $100.00 is due at pick-up.",
    }),
    [shop.name, hours, shop.business_hours?.schedule, shop.time_zone],
  );

  const onSaved = async (text: string) => {
    setMsg({ tone: "info", text });
    await load();
  };
  const onError = (text: string) => setMsg({ tone: "error", text });

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {!canEdit ? (
        <FormAlert tone="info">Only Admins can change message templates.</FormAlert>
      ) : null}
      {msg ? <FormAlert tone={msg.tone}>{msg.text}</FormAlert> : null}
      <Panel
        title="How messages work"
        description={
          <>
            Messages confirmed during quiet hours ({shop.quiet_hours_start.slice(0, 5)}–
            {shop.quiet_hours_end.slice(0, 5)}, set in{" "}
            <Link to="/app/settings/shop" className="underline">
              Shop
            </Link>
            ) go out when quiet hours end. You can use {VARIABLES.join(", ")}. {"{pickup_hours}"}{" "}
            says when the customer can come next, from your weekly hours; {"{shop_hours}"} lists the
            whole week; {"{promised_date}"} includes that day&rsquo;s hours.
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Texts come from Mend's shared number. Customers can reply STOP to opt out.
        </p>
      </Panel>

      {statuses === null ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <>
          <TemplateEditor
            shopId={shop.id}
            title="Ticket created"
            description="Sent automatically when someone creates a ticket and the customer agreed to updates."
            kind="created"
            statusId={null}
            sms={templates.find((t) => t.kind === "created" && t.channel === "sms")}
            email={templates.find((t) => t.kind === "created" && t.channel === "email")}
            sample={sample}
            canEdit={canEdit}
            onSaved={onSaved}
            onError={onError}
          />

          {readyStatus ? (
            <TemplateEditor
              shopId={shop.id}
              title="Ticket ready"
              description="Used when a ticket moves into a status that notifies by default."
              kind="status"
              statusId={readyStatus.id}
              sms={templates.find(
                (t) => t.kind === "status" && t.status_id === readyStatus.id && t.channel === "sms",
              )}
              email={templates.find(
                (t) =>
                  t.kind === "status" && t.status_id === readyStatus.id && t.channel === "email",
              )}
              sample={sample}
              canEdit={canEdit}
              onSaved={onSaved}
              onError={onError}
            />
          ) : (
            <Panel title="Ticket ready">
              <p className="text-sm text-muted-foreground">
                Your shop has no status in the Ready group yet. Add one in{" "}
                <Link to="/app/settings/board" className="underline">
                  Board & fields
                </Link>
                .
              </p>
            </Panel>
          )}

          <TemplateEditor
            shopId={shop.id}
            title="Reminder"
            description="Sent from a ticket with the Send button."
            kind="reminder"
            statusId={null}
            sms={templates.find((t) => t.kind === "reminder" && t.channel === "sms")}
            email={templates.find((t) => t.kind === "reminder" && t.channel === "email")}
            sample={sample}
            canEdit={canEdit}
            onSaved={onSaved}
            onError={onError}
          />

          {otherStatuses.length ? (
            <details className="rounded-md border border-border p-4">
              <summary className="min-h-11 cursor-pointer content-center font-medium">
                Other status messages ({otherStatuses.length})
              </summary>
              <div className="mt-4 flex flex-col gap-6">
                {otherStatuses.map((s) => (
                  <TemplateEditor
                    key={s.id}
                    shopId={shop.id}
                    title={s.name}
                    description={
                      s.notify_by_default
                        ? "Mend offers to send this when a ticket moves here."
                        : "Not offered automatically; staff can still pick it from a ticket."
                    }
                    kind="status"
                    statusId={s.id}
                    sms={templates.find(
                      (t) => t.kind === "status" && t.status_id === s.id && t.channel === "sms",
                    )}
                    email={templates.find(
                      (t) => t.kind === "status" && t.status_id === s.id && t.channel === "email",
                    )}
                    sample={sample}
                    canEdit={canEdit}
                    onSaved={onSaved}
                    onError={onError}
                  />
                ))}
              </div>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}

function TemplateEditor({
  shopId,
  title,
  description,
  kind,
  statusId,
  sms,
  email,
  sample,
  canEdit,
  onSaved,
  onError,
}: {
  shopId: string;
  title: string;
  description?: string;
  kind: MessageKind;
  statusId: string | null;
  sms: Template | undefined;
  email: Template | undefined;
  sample: TemplateVars;
  canEdit: boolean;
  onSaved: (text: string) => Promise<void>;
  onError: (text: string) => void;
}) {
  const [smsBody, setSmsBody] = useState(sms?.body ?? "");
  const [subject, setSubject] = useState(email?.subject ?? "");
  const [emailBody, setEmailBody] = useState(email?.body ?? "");
  const [saving, setSaving] = useState(false);
  const dirty =
    smsBody !== (sms?.body ?? "") ||
    subject !== (email?.subject ?? "") ||
    emailBody !== (email?.body ?? "");
  const preview = renderTemplate(smsBody, sample);
  const seg = smsSegments(preview);
  const id = `tpl-${kind}-${statusId ?? "global"}`;

  /** Create, update or (when emptied) delete one channel's template. */
  async function saveOne(
    channel: Channel,
    existing: Template | undefined,
    body: string,
    subj: string | null,
  ) {
    const db = getSupabase().from("message_templates");
    if (!body.trim()) {
      if (!existing) return null;
      return (await db.delete().eq("id", existing.id).select("id")).error;
    }
    const row = { body: body.trim(), subject: channel === "email" ? subj?.trim() || null : null };
    const r = existing
      ? await db.update(row).eq("id", existing.id).select("id")
      : await db
          .insert({ ...row, shop_id: shopId, kind, status_id: statusId, channel })
          .select("id");
    if (!r.error && !r.data?.length) return { message: "permission denied" };
    return r.error;
  }

  async function submit(): Promise<boolean> {
    if (emailBody.trim() && !subject.trim()) {
      onError("Add an email subject.");
      return false;
    }
    setSaving(true);
    const errs = [
      await saveOne("sms", sms, smsBody, null),
      await saveOne("email", email, emailBody, subject),
    ].filter(Boolean);
    setSaving(false);
    if (errs.length) {
      onError(friendlyDbError(errs[0]));
      return false;
    }
    await onSaved(`${title} saved.`);
    return true;
  }
  useUnsavedChanges(canEdit && dirty, submit);

  return (
    <Panel title={title} description={description}>
      <form
        method="post"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={!canEdit} className="grid gap-4">
          <Field
            id={`${id}-sms`}
            label="Text message"
            hint={
              smsBody.trim()
                ? `Preview: "${preview}" · ${seg.units} characters, ${seg.segments} text${seg.segments > 1 ? "s" : ""}`
                : kind === "created"
                  ? "Leave empty to not send it automatically."
                  : "Leave empty to write the text each time."
            }
          >
            <Textarea
              id={`${id}-sms`}
              rows={3}
              maxLength={1600}
              className="bg-surface-2 text-base"
              value={smsBody}
              onChange={(e) => setSmsBody(e.target.value)}
            />
          </Field>
          <Field id={`${id}-subject`} label="Email subject">
            <Input
              id={`${id}-subject`}
              value={subject}
              maxLength={200}
              onChange={(e) => setSubject(e.target.value)}
            />
          </Field>
          <Field id={`${id}-email`} label="Email message">
            <Textarea
              id={`${id}-email`}
              rows={4}
              maxLength={1600}
              className="bg-surface-2 text-base"
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
            />
          </Field>
        </fieldset>
        {canEdit && dirty ? (
          <Button type="submit" className="mt-4" disabled={saving}>
            {saving ? "Saving…" : "Save templates"}
          </Button>
        ) : null}
      </form>
    </Panel>
  );
}
