# Staging feedback, 19 Oct 2026, round 2 (Oz) and fix plan

Second pass on staging after F1–F12 (decisions 95–106). Each fix is its own PR
into develop, built on the one before.

## Feedback, as given

1. **Board columns fill the width.** With 4 columns they grow to use the
   horizontal space (same padding). A 14" MacBook is the minimum size: more
   columns than fit there scroll sideways. With fewer columns they grow a
   little, then the space between and around them grows; they stay centred.
2. **Logo hint hidden.** Hovering the Mend logo shows a hint that is cut off.
3. **Main search closes on a no-match.** Typing a name that doesn't exist and
   pressing Enter closes the search. It should say nothing was found, with
   tips (spelling etc.).
4. **Dashboard tiles open their view.** Each tile takes you to what it
   counts (e.g. the tickets list filtered to in progress, or due today).
5. **Hints stay after hover.** A rail hint stays until you click elsewhere.
6. **Tiles above every ticket view.** One line of tiles (all six or fewer),
   then the Board right below; the same tiles above Calendar and List,
   collapsible (all at once). Week / month as a dropdown, only in Calendar.
   The view switch must not move when changing view.
7. **List: remove the date picker.**
8. **Month view: tickets, not just names**, on a white background.
9. **Drag and drop still shows only a link** while dragging (not fixed by F3).
10. **Freeze when switching views quickly** (Board / Calendar / List).
11. **Question:** what should a tailor see first on the dashboard?

## Findings

- **10 (freeze):** the app's sign-in check (`/app` `beforeLoad`) runs again
  on every page change and makes two database round trips (membership,
  profile) one after the other before the new page can show; the page's own
  data loads after that. Measured locally on the production build with a
  network delay added: 150 ms per request → 0.9 s per switch; 400 ms → 1.4 s,
  and 12 quick clicks took 3.3 s to settle. Meanwhile the old page stays and
  clicks seem to do nothing. No long browser tasks (largest 61 ms), so it is
  waiting, not computing. The staging server logs show only fast file
  requests (the app talks to the database from the browser).
- **2 (logo hint):** the hint sits inside the rail, whose layer (z-index 30)
  is the same as the sticky top bar's, and the bar comes later in the page, so
  it covers the hint.
- **5 (hints stay):** hints show while the icon has focus; clicking a link
  leaves focus on it, so the hint stays. It should show for keyboard focus
  only.
- **3 (search):** the search list always contains the "Go to" pages, so
  Enter picks the first one (Board) when nothing else matched, and the dialog
  closes on the way there.
- **9 (drag):** the drag uses the browser's built-in drag image, which in
  Chrome on the Mac still shows the link when the drag starts on the card's
  text. Headless tests can't see drag images, which is why F3's test passed.

## Plan

| PR  | Items   | What changes                                                                                                                                                                                                                                                                                |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | 10      | Keep the membership and profile for the session instead of reloading them on every page change; reload when settings change or on sign-in.                                                                                                                                                  |
| G2  | 2, 5    | Rail above the top bar; hints on hover and keyboard focus only.                                                                                                                                                                                                                             |
| G3  | 3       | "Go to" pages only when their name matches; a clear "Nothing found" with tips.                                                                                                                                                                                                              |
| G4  | 9       | Board drag done by Mend instead of the browser: the card itself follows the pointer (works the same in every browser, and on touch screens).                                                                                                                                                |
| G5  | 1       | Columns share the width (min 17 rem, max 24 rem); more than fit scroll; fewer stay centred with even space.                                                                                                                                                                                 |
| G6  | 8       | Month view: each day lists its tickets as small white cards (customer · item), first three then "+N more".                                                                                                                                                                                  |
| G7  | 4, 6, 7 | One tiles row (collapsible, remembered) above Board, Calendar and List; tiles open the matching view and filter; fixed header (title, then the view switch; calendar controls on the right with a Week / Month dropdown); date picker removed from List; filters readable from the address. |

The tile set follows the answer to item 11 (decision 109).
