# Staging feedback, 19 Oct 2026 (Oz) and fix plan

Feedback on the redesign (decisions 91–94) after testing staging. Each item
becomes its own PR into develop; staging is re-tested before the next release.
Order: quick fixes first, then the navigation change, then the bigger views.

## Feedback, as given

1. **Sticky header.** The top bar stays visible while the page scrolls.
2. **Drag and drop.** Dragged board cards lose their look; sometimes only a link is shown while dragging.
3. **Rail.** Menu icons centred vertically, not stacked at the top. The dashboard (Board) is reached from the Mend icon at the top, not a menu item. Later: shops can upload their own logo for that icon in Settings (Pro only).
4. **Calendar inside Tickets.** Not its own menu entry: Tickets switches between board (kanban), calendar and list.
5. **New ticket: "New customer" / "New service" first.** They lead the search results so they're never buried at the bottom of a long list. Icons: the customer icon and the catalog icon used in the menu (not the magnifier and +).
6. **Month view shows tickets.** Each day lists its tickets by customer name, not "1 ticket".
7. **Calendar chips are filters.** "Due", "Overdue" etc. are clickable; they show the matching tickets as a grouped list (e.g. overdue tickets from different dates).
8. **Corner radius.** Tables, search and text inputs use the same radius as the banners (smaller than the cards now).
9. **Customer list.** More columns: customer since, repairs done, pending; a last column with a Message action that opens the Messages panel on that customer.
10. **Messages, chat style.** Customer list on the left (next to the menu) with a preview of the last message; the chat opens in the main area. Shop messages on one side, customer messages on the other (Oz wrote "left" twice; we'll use the usual layout: shop on the right, customer on the left, and confirm).
11. **Catalog as a table.** Proper table; more columns (e.g. added by); set a discount from the row without opening the item; the whole row opens the item.
12. **Clickable cells become filters (all tables).** In Tickets, Customers and Catalog every value can be clicked to filter (status, created by, price…), shown as coloured chips. The item stays plain text (editable, derived from the description); the customer is clickable but plain text, no chip.
13. **Search + filter bar on each list page.** One bar per page that suggests that page's filters as you click and type.
14. **Back button.** A real round black "‹" button instead of the "‹ Tickets" text link.
15. **Main search.** Matches customer name, item / description and dates; centred and a bit wider.
16. **Profile menu.** The profile moves from the top right to the bottom of the rail (where Sign out is now); clicking it shows Settings and Sign out.

## Plan

| PR | Items | What changes | Database |
| -- | ----- | ------------ | -------- |
| F1 | 1, 8, 14 | Sticky top bar; one smaller radius token for tables/inputs/search (matches the banners); round black back button component used on every detail page. | — |
| F2 | 3, 16 | Rail: Mend icon = dashboard, Board item removed, items centred, profile button at the bottom with a menu (name, role, Settings, Sign out); Settings leaves the rail. Phone tab bar follows (Board via the logo tab). Custom logo per shop noted for the Pro tier (no plans/tiers exist yet; built when pricing tiers are). | — |
| F3 | 2 | Drag preview: custom drag image of the whole card (not the inner link), card dims in place; check in Chrome and Safari. | — |
| F4 | 4, 6, 7 | Tickets gets a view switch: Board · Calendar · List. Calendar route moves under Tickets (old /app/calendar redirects). Month cells list customer names (first 3, "+N more"). Summary chips become filter toggles that show a grouped list (by date). | — |
| F5 | 5 | New-ticket pickers: "New customer" / "New service" pinned first; menu icons (Users, BookOpen). | — |
| F6 | 15 | Search matches customer name, item, description and dates ("Oct 20", "2026-10-20"); centred, wider pill. | `search_shop` extended (migration + pgTAP). |
| F7 | 12, 13 | Shared filter bar (chips + suggestions as you type) and clickable coloured value chips; applied to Tickets list first. | — |
| F8 | 9 | Customer list columns: since, repairs done, pending, Message button. | `customer_stats` view or RPC (migration + pgTAP). |
| F9 | 10 | Messages as a two-pane chat: conversations by customer with last-message preview; chat thread with bubbles; composer sends through the existing `queue_message` (same rules: opt-outs, quiet hours, limits). Opens from the customer list's Message button. | Conversation list query (migration + pgTAP). |
| F10 | 11, 12 | Catalog as a table: columns incl. added by; inline discount; row opens the item; filter bar from F7. | `catalog_items.created_by` if missing (migration). |

Questions to confirm while building:
- Item 10: which side for whose messages (we assume shop on the right).
- Item 3: "Pro" logo upload waits for pricing tiers; the logo upload in Settings exists today for every shop's PDFs.
