#!/usr/bin/env bash
# Fails if secret-looking values or server-only key names reach the repo or the
# client bundle (docs/spec.md §3 "secrets live only in Edge Functions";
# addendum §8 "provider keys absent from the client bundle, checked by a grep step in CI").
#
# Usage: scripts/check-no-secrets.sh            (tracked files)
#        scripts/check-no-secrets.sh .output/public   (also scan a build output dir)
set -euo pipefail

# Values that are secret by shape. The publishable key (sb_publishable_) is
# public by design and is NOT matched.
value_patterns='sb_secret_[A-Za-z0-9_-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|"role"\s*:\s*"service_role"'
# Names of server-only variables that must never be referenced by client code.
client_name_patterns='SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|TWILIO_AUTH_TOKEN|RESEND_API_KEY|POSTMARK_SERVER_TOKEN'

status=0

# 1. Tracked files: no secret values anywhere (docs and .env.example included).
if git grep -nIE "$value_patterns" -- . ':!scripts/check-no-secrets.sh'; then
  echo "✗ secret-looking value in a tracked file" >&2; status=1
fi

# 2. Client source: no server-only names (src/ is shipped to the browser).
if git grep -nIE "$client_name_patterns" -- src; then
  echo "✗ server-only secret name referenced in src/" >&2; status=1
fi

# 3. Optional build output (client assets only).
if [[ $# -gt 0 ]]; then
  if grep -rnIE "$value_patterns|$client_name_patterns" "$1"; then
    echo "✗ secret or server-only name in build output $1" >&2; status=1
  fi
fi

[[ $status -eq 0 ]] && echo "✓ no secrets found"
exit $status
