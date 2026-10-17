// Decision 88: the footer and headers every email carries. CASL asks for the
// sender's identity (name, mailing address) and a working unsubscribe link;
// RFC 8058 List-Unsubscribe-Post lets mail apps unsubscribe in one click.

export type Footer = {
  token: string;
  page_url: string;
  shop_name: string;
  shop_address: string | null;
};

export function withEmailFooter(body: string, f: Footer): string {
  const who = [f.shop_name, f.shop_address?.replace(/\s*\n\s*/g, ", ")].filter(Boolean).join(", ");
  return `${body.trimEnd()}\n\n--\n${who}\nStop emails from ${f.shop_name}: ${f.page_url}\n`;
}

export function unsubscribeHeaders(oneClickUrl: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${oneClickUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
