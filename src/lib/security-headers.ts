// Security headers for every page the server sends (spec §4 "Other
// defaults": CSP, HSTS, frame-ancestors; decision 59).
//
// The CSP covers what can be locked down without breaking the app: no
// framing, no plugins, no <base> or form posts to other sites. It does NOT yet
// restrict scripts or connections: TanStack Start puts inline scripts in the
// page for hydration, and a script-src without a per-request nonce would block
// them. That gap is listed in docs/security-review.md.
export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Mend uses the camera only through a file picker; nothing else.
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
};

/** Returns the response with the security headers set (existing ones win). */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
