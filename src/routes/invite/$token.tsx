import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AuthLayout, FormAlert } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { friendlyDbError, ROLE_LABEL, type Role } from "@/lib/shop";
import { getSupabase } from "@/lib/supabase";

// Invite link (spec §5 "Invite flow"). Shows the shop and role, then the
// person logs in or signs up and accepts. The server checks the token, the
// email match and the expiry; nothing here is trusted.
export const Route = createFileRoute("/invite/$token")({
  ssr: false,
  head: () => ({ meta: [{ title: "Invitation · Mend" }, { name: "robots", content: "noindex" }] }),
  component: InvitePage,
});

type Preview = {
  shop_name: string | null;
  role: Role | null;
  email_hint: string | null;
  status: string;
};

const STATUS_TEXT: Record<string, string> = {
  invalid: "This invite link isn't valid. Ask the shop to send you a new one.",
  expired: "This invite has expired. Ask the shop to send you a new one.",
  used: "This invite has already been used.",
  revoked: "This invite was cancelled by the shop.",
};

function InvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [signedIn, setSignedIn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const here = `/invite/${token}`;

  useEffect(() => {
    void (async () => {
      const sb = getSupabase();
      const [{ data }, { data: session }] = await Promise.all([
        sb.rpc("invite_preview", { p_token: token }),
        sb.auth.getSession(),
      ]);
      setPreview(
        ((data as Preview[] | null) ?? [])[0] ?? {
          shop_name: null,
          role: null,
          email_hint: null,
          status: "invalid",
        },
      );
      setSignedIn(session.session?.user.email ?? null);
    })();
  }, [token]);

  async function accept() {
    setBusy(true);
    setError(null);
    const { error } = await getSupabase().rpc("accept_invite", { p_token: token });
    setBusy(false);
    if (error) return setError(friendlyDbError(error));
    await navigate({ to: "/app/board", replace: true });
  }

  if (!preview) {
    return (
      <AuthLayout title="Opening your invite…">
        <p role="status" className="text-muted-foreground">
          One moment.
        </p>
      </AuthLayout>
    );
  }
  if (preview.status !== "valid") {
    return (
      <AuthLayout title="Invite unavailable">
        <FormAlert tone="error">{STATUS_TEXT[preview.status] ?? STATUS_TEXT["invalid"]}</FormAlert>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={`Join ${preview.shop_name}`}
      subtitle={
        <>
          You've been invited as{" "}
          <strong className="text-foreground">
            {preview.role ? ROLE_LABEL[preview.role] : ""}
          </strong>
          . This invite is for <span className="font-mono">{preview.email_hint}</span>.
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <FormAlert tone="error">{error}</FormAlert> : null}
        {signedIn ? (
          <>
            <p className="text-muted-foreground">Signed in as {signedIn}.</p>
            <Button size="lg" onClick={() => void accept()} disabled={busy}>
              {busy ? "Joining…" : `Join ${preview.shop_name}`}
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                void getSupabase()
                  .auth.signOut()
                  .then(() => setSignedIn(null))
              }
            >
              Use a different account
            </Button>
          </>
        ) : (
          <>
            <Button asChild size="lg">
              <Link to="/signup" search={{ next: here }}>
                Create an account
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/login" search={{ redirect: here }}>
                I already have an account
              </Link>
            </Button>
            <p className="text-sm text-muted-foreground">
              Use the email address this invite was sent to.
            </p>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
