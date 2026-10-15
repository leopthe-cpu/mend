// Shared "required fields on submit" helper (UX plan v2, 15 Oct). A form lists
// its required fields from top to bottom; on submit the helper focuses the
// first missing one and returns only that message. After it is fixed, the next
// submit moves on to the next one.

export type RequiredField = {
  /** Element id to focus; the message is shown next to the same field. */
  id: string;
  ok: boolean;
  message: string;
};

export function firstMissingField(fields: RequiredField[]): RequiredField | null {
  for (const field of fields) if (!field.ok) return field;
  return null;
}

/** Focus the first missing field and return it, or null when all are filled. */
export function focusFirstMissingField(fields: RequiredField[]): RequiredField | null {
  const missing = firstMissingField(fields);
  if (missing) requestAnimationFrame(() => document.getElementById(missing.id)?.focus());
  return missing;
}
