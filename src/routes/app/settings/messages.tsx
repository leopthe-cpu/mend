import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Field, Panel } from "@/components/app/Field";
import { FormAlert } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  type Channel,
  fetchTemplates,
  renderTemplate,
  smsSegments,
  type Template,
  VARIABLES,
} from "@/lib/messages";
import { friendlyDbError, roleAtLeast } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
import { fetchStatuses, type Status } from "@/lib/tickets";

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

  const sample = useMemo(
    () => ({
      customer_name: "Maria Rossi",
      item_name: "winter coat",
      shop_name: shop.name,
      ticket_number: 1042,
      pickup_hours: shop.business_hours?.text ?? "",
    }),
    [shop.name, shop.business_hours],
  );

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {!canEdit ? (
        <FormAlert tone="info">Only the Owner and Admins can change message templates.</FormAlert>
      ) : null}
      {msg ? <FormAlert tone={msg.tone}>{msg.text}</FormAlert> : null}
      <Panel
        title="How messages work"
        description={
          <>
            When a ticket moves into a status marked "notify by default" (in{" "}
            <Link to="/app/settings/board" className="underline">
              Board &amp; fields
            </Link>
            ), Mend shows the message and waits for you to press Send. You can edit it each time.
            Messages confirmed during quiet hours ({shop.quiet_hours_start.slice(0, 5)}–
            {shop.quiet_hours_end.slice(0, 5)}, set in Shop) go out when quiet hours end. You can
            use {VARIABLES.join(", ")}.
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
        statuses.map((s) => (
          <StatusTemplates
            key={s.id}
            shopId={shop.id}
            status={s}
            sms={templates.find((t) => t.status_id === s.id && t.channel === "sms")}
            email={templates.find((t) => t.status_id === s.id && t.channel === "email")}
            sample={sample}
            canEdit={canEdit}
            onSaved={async (text) => {
              setMsg({ tone: "info", text });
              await load();
            }}
            onError={(text) => setMsg({ tone: "error", text })}
          />
        ))
      )}
    </div>
  );
}

function StatusTemplates({
  shopId,
  status,
  sms,
  email,
  sample,
  canEdit,
  onSaved,
  onError,
}: {
  shopId: string;
  status: Status;
  sms: Template | undefined;
  email: Template | undefined;
  sample: Parameters<typeof renderTemplate>[1];
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
  const id = `tpl-${status.id}`;

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
      : await db.insert({ ...row, shop_id: shopId, status_id: status.id, channel }).select("id");
    if (!r.error && !r.data?.length) return { message: "permission denied" };
    return r.error;
  }

  return (
    <Panel
      title={status.name}
      description={
        status.notify_by_default
          ? "Mend offers to send this when a ticket moves here."
          : "Not offered automatically; staff can still pick it from a ticket."
      }
    >
      <form
        method="post"
        onSubmit={async (e) => {
          e.preventDefault();
          if (emailBody.trim() && !subject.trim()) return onError("Add an email subject.");
          setSaving(true);
          const errs = [
            await saveOne("sms", sms, smsBody, null),
            await saveOne("email", email, emailBody, subject),
          ].filter(Boolean);
          setSaving(false);
          if (errs.length) return onError(friendlyDbError(errs[0]));
          await onSaved(`Templates for ${status.name} saved.`);
        }}
      >
        <fieldset disabled={!canEdit} className="grid gap-4">
          <Field
            id={`${id}-sms`}
            label="Text message"
            hint={
              smsBody.trim()
                ? `Preview: "${preview}" · ${seg.units} characters, ${seg.segments} text${seg.segments > 1 ? "s" : ""}`
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
