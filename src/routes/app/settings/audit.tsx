import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { FormAlert } from "@/components/auth/AuthLayout";
import { friendlyDbError, roleAtLeast } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";

// Owner/Admin view of the append-only audit trail (spec §4). RLS returns no
// rows to Staff, whatever this page does.
export const Route = createFileRoute("/app/settings/audit")({
  component: AuditLog,
});

type Row = {
  id: string;
  created_at: string;
  actor_id: string | null;
  action: string;
  entity: string;
};

const LABELS: Record<string, string> = {
  "shop.created": "Shop created",
  "shops.update": "Shop settings changed",
  "invite.created": "Invite created",
  "invite.revoked": "Invite revoked",
  "member.joined": "Member joined",
  "member.removed": "Member removed",
  "member.role_changed": "Role changed",
  "shop.ownership_transferred": "Ownership transferred",
};
const label = (a: string) =>
  LABELS[a] ?? a.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function AuditLog() {
  const { membership } = Route.useRouteContext();
  const [rows, setRows] = useState<Row[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const sb = getSupabase();
      const { data, error } = await sb
        .from("audit_log")
        .select("id, created_at, actor_id, action, entity")
        .eq("shop_id", membership.shop.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) return setError(friendlyDbError(error));
      setRows((data ?? []) as Row[]);
      const ids = [...new Set((data ?? []).map((r) => r.actor_id).filter(Boolean))] as string[];
      if (ids.length) {
        const { data: p } = await sb
          .from("profiles")
          .select("user_id, full_name, email")
          .in("user_id", ids);
        setNames(
          new Map(
            (p ?? []).map((x) => [
              x.user_id as string,
              (x.full_name as string) || (x.email as string),
            ]),
          ),
        );
      }
    })();
  }, [membership.shop.id]);

  if (!roleAtLeast(membership.role, "admin")) {
    return <FormAlert tone="info">Only the Owner and Admins can see the audit log.</FormAlert>;
  }
  const fmt = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: membership.shop.time_zone,
  });

  return (
    <div className="max-w-3xl">
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      <p className="mb-4 text-muted-foreground">
        Every change to your team, settings, catalog and prices. Entries can't be edited or deleted.
      </p>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-left">
          <thead className="border-b border-border text-sm text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">Who</th>
              <th className="px-4 py-3 font-medium">What</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-sm">
                  {fmt.format(new Date(r.created_at))}
                </td>
                <td className="px-4 py-3">{(r.actor_id && names.get(r.actor_id)) || "System"}</td>
                <td className="px-4 py-3">{label(r.action)}</td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-muted-foreground">
                  No entries yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
