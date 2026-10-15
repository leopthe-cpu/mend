import { Eye, Lock } from "lucide-react";
import { useState } from "react";

import { Panel } from "@/components/app/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { friendlyDbError } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";
import type { Ticket } from "@/lib/tickets";

export function PasscodePanel({
  ticket,
  shopVertical,
  canReveal,
  passcode,
  onPasscodeChange,
  onReload,
}: {
  ticket: Ticket;
  shopVertical: string;
  canReveal: boolean;
  passcode: string | null;
  onPasscodeChange: (v: string | null) => void;
  onReload: () => void;
}) {
  const [newPasscode, setNewPasscode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (shopVertical !== "electronics" && !ticket.has_passcode) return null;

  async function reveal() {
    const { data, error } = await getSupabase().rpc("reveal_passcode", {
      p_ticket_id: ticket.id,
    });
    if (error) {
      setMsg(friendlyDbError(error));
    } else {
      onPasscodeChange((data as string | null) ?? "");
      await onReload();
    }
  }

  async function savePasscode() {
    setSaving(true);
    const { error } = await getSupabase().rpc("set_ticket_passcode", {
      p_ticket_id: ticket.id,
      p_passcode: newPasscode,
    });
    if (error) {
      setMsg(friendlyDbError(error));
    } else {
      setNewPasscode("");
      onPasscodeChange(null);
      setMsg("Passcode saved.");
      await onReload();
    }
    setSaving(false);
  }

  return (
    <Panel title="Device passcode">
      {msg ? <p className="mb-4 text-sm text-success">{msg}</p> : null}
      {ticket.has_passcode ? (
        passcode !== null ? (
          <p className="font-mono text-xl tracking-wider">{passcode}</p>
        ) : canReveal ? (
          <Button variant="outline" onClick={() => void reveal()}>
            <Eye /> Reveal
          </Button>
        ) : (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Lock className="size-4" /> Saved. Only the owner, admins or the assigned person can
            reveal it.
          </p>
        )
      ) : (
        <p className="text-muted-foreground">No passcode saved.</p>
      )}
      <div className="mt-4 flex gap-2">
        <Input
          aria-label="New passcode"
          type="password"
          autoComplete="off"
          placeholder={ticket.has_passcode ? "Replace passcode" : "Save a passcode"}
          value={newPasscode}
          onChange={(e) => setNewPasscode(e.target.value)}
          maxLength={64}
        />
        <Button variant="outline" disabled={!newPasscode || saving} onClick={() => void savePasscode()}>
          Save
        </Button>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Encrypted. Every reveal is recorded. Deleted automatically at pickup.
      </p>
    </Panel>
  );
}