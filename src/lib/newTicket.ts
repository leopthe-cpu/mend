// Opens the one New ticket dialog, which lives in the top bar, from anywhere
// in the app (e.g. the + on the board's first column; decision 115). A window
// event keeps the dialog in one place instead of a second copy per page.
const EVENT = "mend:new-ticket";

export function openNewTicket() {
  window.dispatchEvent(new Event(EVENT));
}

export function onOpenNewTicket(open: () => void): () => void {
  window.addEventListener(EVENT, open);
  return () => window.removeEventListener(EVENT, open);
}
