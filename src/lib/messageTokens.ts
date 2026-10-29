// Messages with ticket details as tokens (decision 146): the column window
// keeps them as {placeholders}, the send window as the ticket's values.

export type Segment = { text: string } | { field: string; text: string };

export type TokenOption = {
  /** The template variable, e.g. "customer_first_name". */
  field: string;
  label: string;
  /** In the send window: this ticket's value. Absent in the column window. */
  value?: string;
};

/** "Hi {customer_first_name}" -> segments, with each token's text from `show`. */
export function parseTemplate(template: string, show: (field: string) => string | null): Segment[] {
  const out: Segment[] = [];
  const re = /\{([a-z_]+)\}/g;
  let last = 0;
  for (let m = re.exec(template); m; m = re.exec(template)) {
    const text = show(m[1]!);
    if (text === null) continue;
    if (m.index > last) out.push({ text: template.slice(last, m.index) });
    out.push({ field: m[1]!, text });
    last = m.index + m[0].length;
  }
  if (last < template.length) out.push({ text: template.slice(last) });
  return out;
}

/** Back to a template: tokens become {field}. */
export function toTemplate(segments: Segment[]): string {
  return segments.map((s) => ("field" in s ? `{${s.field}}` : s.text)).join("");
}

/** What gets sent: tokens become their text. */
export function toPlain(segments: Segment[]): string {
  return segments.map((s) => s.text).join("");
}
