import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ChevronLeft, Mail, MessageSquare, Search, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EmptyState, PageHeader } from "@/components/app/EmptyState";
import { selectClass } from "@/components/app/Field";
import { FormAlert } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  type Channel,
  kickSender,
  type Message,
  type MessageStatus,
  shopTime,
  smsSegments,
  STATUS_TEXT,
} from "@/lib/messages";
import { friendlyDbError, missingTextContact, TEXTS_NEED_CONTACT } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
import { fetchContacts } from "@/lib/tickets";
import { cn } from "@/lib/utils";

// Messages as conversations, like WhatsApp Web (19 Oct feedback, item 10;
// decision 104): customers on the left with their latest message, the chosen
// customer's messages on the right with a box to write a new one. Only what
// the shop sent is shown: texts go out from Mend's shared number, so replies
// (other than STOP / START) don't reach Mend.

type MsgSearch = { customer?: string };

export const Route = createFileRoute("/app/messages")({
  head: () => ({ meta: [{ title: "Messages · Mend" }] }),
  validateSearch: (s: Record<string, unknown>): MsgSearch =>
    typeof s["customer"] === "string" && /^[0-9a-f-]{36}$/i.test(s["customer"])
      ? { customer: s["customer"] }
      : {},
  component: MessagesPage,
});

type Thread = {
  customer_id: string;
  customer_name: string;
  last_channel: Channel;
  last_subject: string | null;
  last_body: string;
  last_status: MessageStatus;
  last_at: string;
};

type Row = Message & { ticket: { ticket_number: number; item_name: string } | null };

type Person = {
  id: string;
  name: string;
  preferred_channel: Channel;
  sms_opted_out: boolean;
  email_opted_out: boolean;
  phone: string | null;
  email: string | null;
};

type TicketOption = { id: string; ticket_number: number; item_name: string };

/** Start of the current calendar month in the shop's time zone, as an ISO instant. */
function monthStartIso(timeZone: string): string {
  const now = new Date();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      timeZoneName: "longOffset",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  // e.g. "GMT-04:00" -> "-04:00"; "GMT" alone means UTC.
  const offset = (parts["timeZoneName"] ?? "GMT").replace("GMT", "") || "+00:00";
  return new Date(`${parts["year"]}-${parts["month"]}-01T00:00:00${offset}`).toISOString();
}

function MessagesPage() {
  const { membership } = Route.useRouteContext();
  const shop = membership.shop;
  const { customer: selected } = Route.useSearch();
  const navigate = useNavigate({ from: "/app/messages" });
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [query, setQuery] = useState("");
  const [failedOnly, setFailedOnly] = useState(false);
  const [smsThisMonth, setSmsThisMonth] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A customer opened from elsewhere (customer list "Message") who has no
  // messages yet still gets a conversation at the top of the list.
  const [extra, setExtra] = useState<Thread | null>(null);

  const loadThreads = useCallback(async () => {
    try {
      const db = getSupabase();
      const [list, usage] = await Promise.all([
        db
          .from("message_threads")
          .select(
            "customer_id, customer_name, last_channel, last_subject, last_body, last_status, last_at",
          )
          .eq("shop_id", shop.id)
          .order("last_at", { ascending: false })
          .limit(300),
        db
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("shop_id", shop.id)
          .eq("channel", "sms")
          .neq("status", "canceled")
          .gte("created_at", monthStartIso(shop.time_zone)),
      ]);
      if (list.error) throw list.error;
      setThreads((list.data ?? []) as Thread[]);
      setSmsThisMonth(usage.count ?? 0);
    } catch (e) {
      setError(friendlyDbError(e));
    }
  }, [shop.id, shop.time_zone]);
  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    setExtra(null);
    if (!selected || !threads || threads.some((t) => t.customer_id === selected)) return;
    void getSupabase()
      .from("customers")
      .select("id, name")
      .eq("id", selected)
      .maybeSingle()
      .then(({ data }) => {
        if (data)
          setExtra({
            customer_id: data.id as string,
            customer_name: data.name as string,
            last_channel: "sms",
            last_subject: null,
            last_body: "",
            last_status: "queued",
            last_at: "",
          });
      });
  }, [selected, threads]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...(extra ? [extra] : []), ...(threads ?? [])].filter(
      (t) =>
        (!q ||
          t.customer_name.toLowerCase().includes(q) ||
          t.last_body.toLowerCase().includes(q)) &&
        (!failedOnly || t.last_status === "failed"),
    );
  }, [threads, extra, query, failedOnly]);

  const open = (id: string | undefined) =>
    void navigate({ search: id ? { customer: id } : {}, replace: false });

  return (
    <>
      <PageHeader title="Messages">
        {smsThisMonth !== null ? (
          <p className="text-muted-foreground">
            Texts this month: {smsThisMonth} of {shop.sms_monthly_cap}
          </p>
        ) : null}
      </PageHeader>
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      {threads !== null && !threads.length && !extra ? (
        <EmptyState eyebrow="Nothing yet" title="No messages">
          When a ticket moves to a status that notifies (like Ready), Mend asks before texting or
          emailing the customer. Conversations show up here, newest first.
        </EmptyState>
      ) : (
        <div className="flex h-[calc(100svh-17rem)] min-h-[24rem] overflow-hidden rounded-lg bg-card md:h-[calc(100svh-10rem)]">
          {/* Left: conversations. On phones only one pane shows at a time. */}
          <aside
            aria-label="Conversations"
            className={cn(
              "flex w-full shrink-0 flex-col border-r border-border md:w-80 lg:w-96",
              selected && "hidden md:flex",
            )}
          >
            <div className="flex flex-col gap-2 border-b border-border p-3">
              <div className="relative">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  type="search"
                  aria-label="Search conversations"
                  placeholder="Search names and messages"
                  className="pl-9"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <label className="flex min-h-9 items-center gap-2 px-1 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={failedOnly}
                  onChange={(e) => setFailedOnly(e.target.checked)}
                />
                Only where the last message failed
              </label>
            </div>
            {threads === null ? (
              <p className="p-4 text-muted-foreground">Loading…</p>
            ) : (
              <ul className="flex-1 overflow-y-auto">
                {shown.map((t) => (
                  <li key={t.customer_id}>
                    <button
                      type="button"
                      aria-current={t.customer_id === selected ? "true" : undefined}
                      onClick={() => open(t.customer_id)}
                      className={cn(
                        "flex w-full cursor-pointer flex-col gap-0.5 border-b border-border px-4 py-3 text-left hover:bg-background",
                        t.customer_id === selected && "bg-background",
                      )}
                    >
                      <span className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate font-semibold">
                          {t.customer_name}
                        </span>
                        <span className="shrink-0 text-sm text-muted-foreground">
                          {t.last_at ? shopTime(t.last_at, shop.time_zone) : "New"}
                        </span>
                      </span>
                      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        {t.last_at ? (
                          t.last_status === "failed" ? (
                            <AlertTriangle aria-label="Failed" className="size-4 text-danger" />
                          ) : t.last_channel === "sms" ? (
                            <MessageSquare aria-hidden className="size-4" />
                          ) : (
                            <Mail aria-hidden className="size-4" />
                          )
                        ) : null}
                        <span className="truncate">
                          {t.last_at
                            ? `${t.last_subject ? `${t.last_subject}: ` : ""}${t.last_body}`
                            : "No messages yet"}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
                {!shown.length ? (
                  <li className="p-4 text-muted-foreground">No conversations match.</li>
                ) : null}
              </ul>
            )}
          </aside>
          {/* Right: the conversation. */}
          <section
            aria-label="Conversation"
            className={cn("min-w-0 flex-1 flex-col", selected ? "flex" : "hidden md:flex")}
          >
            {selected ? (
              <Conversation
                key={selected}
                customerId={selected}
                shopId={shop.id}
                timeZone={shop.time_zone}
                textsOff={missingTextContact(shop)}
                onBack={() => open(undefined)}
                onSent={loadThreads}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center p-8 text-center text-muted-foreground">
                Pick a customer to see their messages.
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function Conversation({
  customerId,
  shopId,
  timeZone,
  textsOff,
  onBack,
  onSent,
}: {
  customerId: string;
  shopId: string;
  timeZone: string;
  /** The shop has no address or phone yet, so texts can't go out (decision 131). */
  textsOff: boolean;
  onBack: () => void;
  onSent: () => void | Promise<void>;
}) {
  const [person, setPerson] = useState<Person | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [tickets, setTickets] = useState<TicketOption[]>([]);
  const [ticketId, setTicketId] = useState("");
  const [channel, setChannel] = useState<Channel>("sms");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const picked = useRef(false);

  const load = useCallback(async () => {
    try {
      const db = getSupabase();
      const [c, contacts, msgs, tk] = await Promise.all([
        db
          .from("customers")
          .select("id, name, preferred_channel, sms_opted_out, email_opted_out")
          .eq("id", customerId)
          .single(),
        fetchContacts([customerId]),
        db
          .from("messages")
          .select("*, ticket:tickets(ticket_number, item_name)")
          .eq("shop_id", shopId)
          .eq("customer_id", customerId)
          .order("created_at", { ascending: true })
          .limit(500),
        db
          .from("tickets")
          .select("id, ticket_number, item_name")
          .eq("customer_id", customerId)
          .is("deleted_at", null)
          .order("ticket_number", { ascending: false }),
      ]);
      if (c.error) throw c.error;
      if (msgs.error) throw msgs.error;
      const ct = contacts.get(customerId);
      const p = {
        ...(c.data as Omit<Person, "phone" | "email">),
        phone: ct?.phone ?? null,
        email: ct?.email ?? null,
      };
      setPerson(p);
      setRows((msgs.data ?? []) as unknown as Row[]);
      const list = (tk.data ?? []) as TicketOption[];
      setTickets(list);
      setTicketId((cur) => cur || list[0]?.id || "");
      // First load: the customer's preferred channel, or the other one when
      // that's blocked (opted out, no number…).
      if (!picked.current) {
        picked.current = true;
        const pref = p.preferred_channel;
        setChannel(
          blocked(p, pref, textsOff) && !blocked(p, other(pref), textsOff) ? other(pref) : pref,
        );
      }
    } catch (e) {
      setNotice({ tone: "error", text: friendlyDbError(e) });
    }
  }, [customerId, shopId, textsOff]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [rows]);

  async function send() {
    if (!person || !ticketId || !body.trim()) return;
    setSending(true);
    setNotice(null);
    const { data, error } = await getSupabase().rpc("queue_message", {
      p_ticket_id: ticketId,
      p_channel: channel,
      p_body: body,
      p_subject: channel === "email" ? subject : null,
      p_kind: "manual",
    });
    setSending(false);
    if (error) return setNotice({ tone: "error", text: friendlyDbError(error) });
    const r = (data as { scheduled_for: string; quiet_hours: boolean }[] | null)?.[0];
    kickSender();
    setBody("");
    setSubject("");
    if (r?.quiet_hours)
      setNotice({
        tone: "info",
        text: `Quiet hours: it will go out ${shopTime(r.scheduled_for, timeZone)}.`,
      });
    await load();
    await onSent();
  }

  const reason = person ? blocked(person, channel, textsOff) : null;
  const seg = smsSegments(body);

  return (
    <>
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to conversations"
          className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-foreground text-background md:hidden"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          {person ? (
            <Link
              to="/app/customers/$customerId"
              params={{ customerId }}
              className="block truncate text-lg font-semibold underline-offset-4 hover:underline"
            >
              {person.name}
            </Link>
          ) : (
            <span className="text-muted-foreground">Loading…</span>
          )}
          {person ? (
            <span className="block truncate text-sm text-muted-foreground">
              {[person.phone, person.email].filter(Boolean).join(" · ") || "No phone or email"}
            </span>
          ) : null}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto bg-background/60 px-4 py-4">
        {rows && !rows.length ? (
          <p className="text-center text-muted-foreground">No messages to this customer yet.</p>
        ) : null}
        <ol className="flex flex-col gap-3">
          {(rows ?? []).map((m) => {
            const failed = m.status === "failed";
            return (
              <li key={m.id} className="flex flex-col items-end">
                {/* The shop's messages sit on the right (decision 104). */}
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg rounded-br-sm px-3.5 py-2.5 whitespace-pre-wrap wrap-anywhere md:max-w-[70%]",
                    failed ? "bg-danger/10 ring-1 ring-danger/40" : "bg-primary/12",
                  )}
                >
                  {m.subject ? <p className="font-semibold">{m.subject}</p> : null}
                  <p className="[overflow-wrap:anywhere]">{m.body}</p>
                </div>
                <p className="mt-1 flex flex-wrap items-center justify-end gap-x-1.5 text-sm text-muted-foreground">
                  {m.channel === "sms" ? (
                    <MessageSquare aria-label="Text" className="size-3.5" />
                  ) : (
                    <Mail aria-label="Email" className="size-3.5" />
                  )}
                  {m.ticket ? (
                    <Link
                      to="/app/tickets/$ticketId"
                      params={{ ticketId: m.ticket_id }}
                      className="underline-offset-4 hover:underline"
                    >
                      #{m.ticket.ticket_number} · {m.ticket.item_name}
                    </Link>
                  ) : null}
                  <span>·</span>
                  <span className={cn(failed && "font-medium text-danger")}>
                    {m.status === "queued" && m.queued_for_quiet_hours
                      ? `Quiet hours: sends ${shopTime(m.scheduled_for, timeZone)}`
                      : STATUS_TEXT[m.status]}
                  </span>
                  <span>· {shopTime(m.created_at, timeZone)}</span>
                </p>
                {failed && m.error ? <p className="text-sm text-danger">{m.error}</p> : null}
              </li>
            );
          })}
        </ol>
        <div ref={end} />
      </div>

      <form
        className="flex flex-col gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {notice ? <FormAlert tone={notice.tone}>{notice.text}</FormAlert> : null}
        {tickets.length ? (
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="About ticket"
              className={cn(selectClass, "w-auto max-w-full min-w-0 flex-1")}
              value={ticketId}
              onChange={(e) => setTicketId(e.target.value)}
            >
              {tickets.map((t) => (
                <option key={t.id} value={t.id}>
                  #{t.ticket_number} · {t.item_name}
                </option>
              ))}
            </select>
            <div
              role="radiogroup"
              aria-label="Send by"
              className="flex rounded-full bg-background p-1"
            >
              {(["sms", "email"] as const).map((ch) => {
                const why = person ? blocked(person, ch, textsOff) : null;
                return (
                  <button
                    key={ch}
                    type="button"
                    role="radio"
                    aria-checked={channel === ch}
                    disabled={!!why}
                    title={why ?? undefined}
                    onClick={() => setChannel(ch)}
                    className={cn(
                      "h-9 cursor-pointer rounded-full px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50",
                      channel === ch ? "bg-foreground text-background" : "text-foreground",
                    )}
                  >
                    {ch === "sms" ? "Text" : "Email"}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        {!tickets.length && person ? (
          <p className="text-sm text-muted-foreground">
            Messages belong to a ticket; this customer has none yet.
          </p>
        ) : reason ? (
          <p className="text-sm text-danger">{reason}</p>
        ) : null}
        {channel === "email" && tickets.length ? (
          <Input
            aria-label="Email subject"
            placeholder="Subject"
            maxLength={200}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        ) : null}
        <div className="flex items-end gap-2">
          <Textarea
            aria-label="Message"
            placeholder={tickets.length ? "Write a message…" : ""}
            rows={2}
            maxLength={1600}
            disabled={!tickets.length || !!reason}
            className="min-h-12 flex-1 resize-none bg-surface-2 text-base"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter starts a new line (like chat apps).
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <Button
            type="submit"
            size="icon"
            className="size-12 shrink-0"
            aria-label="Send"
            disabled={sending || !body.trim() || !ticketId || !!reason}
          >
            <Send aria-hidden />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {channel === "sms" && body.trim()
            ? `${seg.units} characters, ${seg.segments} text${seg.segments > 1 ? "s" : ""} · `
            : ""}
          Replies to texts don&rsquo;t come back to Mend; customers who answer should call the shop.
        </p>
      </form>
    </>
  );
}

function other(ch: Channel): Channel {
  return ch === "sms" ? "email" : "sms";
}

/** Why this customer can't get a message on this channel, or null. */
function blocked(p: Person, ch: Channel, textsOff: boolean): string | null {
  if (ch === "sms") {
    if (textsOff) return TEXTS_NEED_CONTACT;
    if (p.sms_opted_out) return "Texts are off for this customer (replied STOP or asked you).";
    if (!p.phone) return "No mobile number on file.";
  } else {
    if (p.email_opted_out) return "Emails are off for this customer.";
    if (!p.email) return "No email address on file.";
  }
  return null;
}
