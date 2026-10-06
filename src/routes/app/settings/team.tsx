import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { FormAlert } from "@/components/auth/AuthLayout";
import { Field, Panel, selectClass } from "@/components/app/Field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { friendlyDbError, ROLE_LABEL, roleAtLeast, type Role } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";

export const Route = createFileRoute("/app/settings/team")({
  component: TeamSettings,
});

type Member = { user_id: string; role: Role; created_at: string; name: string; email: string };
type Invite = {
  id: string;
  email: string;
  role: Role;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
};

function inviteStatus(i: Invite): "Pending" | "Accepted" | "Revoked" | "Expired" {
  if (i.used_at) return "Accepted";
  if (i.revoked_at) return "Revoked";
  if (new Date(i.expires_at) <= new Date()) return "Expired";
  return "Pending";
}

function TeamSettings() {
  const { membership, user } = Route.useRouteContext();
  const router = useRouter();
  const shopId = membership.shop.id;
  const myRole = membership.role;
  const isAdmin = roleAtLeast(myRole, "admin");
  const isOwner = myRole === "owner";
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("staff");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [transferTo, setTransferTo] = useState<Member | null>(null);

  const load = useCallback(async () => {
    const sb = getSupabase();
    const { data: rows, error } = await sb
      .from("memberships")
      .select("user_id, role, created_at")
      .eq("shop_id", shopId)
      .order("created_at");
    if (error) return setMessage({ tone: "error", text: friendlyDbError(error) });
    const ids = (rows ?? []).map((r) => r.user_id as string);
    const { data: profiles } = await sb
      .from("profiles")
      .select("user_id, full_name, email")
      .in("user_id", ids);
    const byId = new Map((profiles ?? []).map((p) => [p.user_id as string, p]));
    setMembers(
      (rows ?? []).map((r) => ({
        user_id: r.user_id as string,
        role: r.role as Role,
        created_at: r.created_at as string,
        name: (byId.get(r.user_id)?.full_name as string) || "",
        email: (byId.get(r.user_id)?.email as string) || "",
      })),
    );
    if (isAdmin) {
      const { data: inv } = await sb
        .from("invites")
        .select("id, email, role, expires_at, used_at, revoked_at")
        .eq("shop_id", shopId)
        .order("created_at", { ascending: false })
        .limit(50);
      setInvites((inv ?? []) as Invite[]);
    }
  }, [shopId, isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => PromiseLike<{ error: unknown }>, done: string) {
    setMessage(null);
    const { error } = await action();
    if (error) return setMessage({ tone: "error", text: friendlyDbError(error) });
    setMessage({ tone: "info", text: done });
    await load();
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setLink(null);
    setCopied(false);
    const { data, error } = await getSupabase().rpc("create_invite", {
      p_shop_id: shopId,
      p_email: inviteEmail,
      p_role: inviteRole,
    });
    if (error) return setMessage({ tone: "error", text: friendlyDbError(error) });
    const token = (data as { token: string }[])[0]?.token;
    if (token) setLink(`${window.location.origin}/invite/${token}`);
    setInviteEmail("");
    await load();
  }

  // Who can I act on? Owner: Admin and Staff. Admin: Staff. Never the Owner or myself.
  const canManage = (m: Member) =>
    m.user_id !== user.id &&
    m.role !== "owner" &&
    (isOwner || (myRole === "admin" && m.role === "staff"));

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {message ? <FormAlert tone={message.tone}>{message.text}</FormAlert> : null}

      <Panel title="Members">
        <ul className="divide-y divide-border">
          {members.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {m.name || m.email}
                  {m.user_id === user.id ? (
                    <span className="text-muted-foreground"> (you)</span>
                  ) : null}
                </div>
                {m.name ? (
                  <div className="truncate text-sm text-muted-foreground">{m.email}</div>
                ) : null}
              </div>
              {isOwner && canManage(m) ? (
                <select
                  aria-label={`Role for ${m.name || m.email}`}
                  className={`${selectClass} w-32`}
                  value={m.role}
                  onChange={(e) =>
                    void run(
                      () =>
                        getSupabase().rpc("change_member_role", {
                          p_shop_id: shopId,
                          p_user_id: m.user_id,
                          p_role: e.target.value,
                        }),
                      "Role updated.",
                    )
                  }
                >
                  <option value="admin">Admin</option>
                  <option value="staff">Staff</option>
                </select>
              ) : (
                <span className="font-mono text-sm uppercase">{ROLE_LABEL[m.role]}</span>
              )}
              {isOwner && m.role !== "owner" ? (
                <Button variant="outline" size="sm" onClick={() => setTransferTo(m)}>
                  Make owner
                </Button>
              ) : null}
              {canManage(m) ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Remove ${m.name || m.email} from ${membership.shop.name}? They lose access right away.`,
                      )
                    )
                      void run(
                        () =>
                          getSupabase().rpc("remove_member", {
                            p_shop_id: shopId,
                            p_user_id: m.user_id,
                          }),
                        "Member removed.",
                      );
                  }}
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </Panel>

      {isAdmin ? (
        <Panel
          title="Invite someone"
          description={isOwner ? "Invite Admins or Staff." : "Admins can invite Staff."}
        >
          <form
            method="post"
            onSubmit={invite}
            className="flex flex-col gap-4 sm:flex-row sm:items-end"
          >
            <div className="flex-1">
              <Field id="invite-email" label="Email">
                <Input
                  id="invite-email"
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </Field>
            </div>
            <div className="sm:w-40">
              <Field id="invite-role" label="Role">
                <select
                  id="invite-role"
                  className={selectClass}
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as Role)}
                >
                  {isOwner ? <option value="admin">Admin</option> : null}
                  <option value="staff">Staff</option>
                </select>
              </Field>
            </div>
            <Button type="submit">Create invite link</Button>
          </form>
          {link ? (
            <div className="mt-4 flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-4">
              <p className="text-sm">
                Send this link to them. It works once, for that email address, for 72 hours.
                (Emailing invites from Mend arrives with email sending.)
              </p>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={link}
                  aria-label="Invite link"
                  onFocus={(e) => e.target.select()}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    void navigator.clipboard.writeText(link).then(() => setCopied(true))
                  }
                >
                  {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          ) : null}
          {invites.length ? (
            <ul className="mt-6 divide-y divide-border">
              {invites.map((i) => {
                const status = inviteStatus(i);
                return (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 py-3">
                    <span className="min-w-0 flex-1 truncate">{i.email}</span>
                    <span className="font-mono text-sm uppercase">{ROLE_LABEL[i.role]}</span>
                    <span className="w-24 text-sm text-muted-foreground">{status}</span>
                    {status === "Pending" && (isOwner || i.role === "staff") ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void run(
                            () => getSupabase().rpc("revoke_invite", { p_invite_id: i.id }),
                            "Invite revoked.",
                          )
                        }
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </Panel>
      ) : null}

      {transferTo ? (
        <TransferDialog
          member={transferTo}
          shopId={shopId}
          email={user.email ?? ""}
          onClose={() => setTransferTo(null)}
          onDone={async () => {
            setTransferTo(null);
            setMessage({ tone: "info", text: "Ownership transferred. You are now an Admin." });
            await router.invalidate();
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

// Ownership transfer needs a fresh password (and the MFA code if enrolled);
// the database checks the session's sign-in time itself (spec §5).
function TransferDialog({
  member,
  shopId,
  email,
  onClose,
  onDone,
}: {
  member: Member;
  shopId: string;
  email: string;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const sb = getSupabase();
    try {
      if (!needsCode) {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw new Error("That password isn't right.");
        const { data: factors } = await sb.auth.mfa.listFactors();
        if (factors?.totp.some((f) => f.status === "verified")) {
          setNeedsCode(true);
          return;
        }
      } else {
        const { data: factors } = await sb.auth.mfa.listFactors();
        const factor = factors?.totp.find((f) => f.status === "verified");
        if (factor) {
          const { error } = await sb.auth.mfa.challengeAndVerify({
            factorId: factor.id,
            code: code.trim(),
          });
          if (error) throw new Error("That code didn't work.");
        }
      }
      const { error } = await sb.rpc("transfer_ownership", {
        p_shop_id: shopId,
        p_new_owner_id: member.user_id,
      });
      if (error) throw new Error(friendlyDbError(error));
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="surface-light bg-background text-foreground">
        <DialogHeader>
          <DialogTitle>Make {member.name || member.email} the owner?</DialogTitle>
          <DialogDescription>
            They get full control, including billing and deleting the shop. You become an Admin.
            Only the new owner can undo this.
          </DialogDescription>
        </DialogHeader>
        <form method="post" onSubmit={confirm} className="flex flex-col gap-4">
          {error ? <FormAlert tone="error">{error}</FormAlert> : null}
          {!needsCode ? (
            <Field id="confirm-password" label="Your password">
              <Input
                id="confirm-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
          ) : (
            <Field id="confirm-code" label="Code from your authenticator app">
              <Input
                id="confirm-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                required
              />
            </Field>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={busy}>
              {busy ? "Transferring…" : "Transfer ownership"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
