# Saffron POS

A restaurant point-of-sale terminal built on Electron, with station-routed kitchen
ticket printing over ESC/POS.

```bash
npm install
npm run dev          # development, with hot reload
npm run test:smoke   # 101-assertion end-to-end check of orders, menu + printing
npm run build        # production bundle
npm run dist:mac     # packaged .dmg  (dist:win for Windows)
```

## Service modes

Set under **Settings → Restaurant**:

| Mode | Screens shown | Home |
|---|---|---|
| `both` (default) | Floor + Counter | Floor |
| `dine_in` | Floor only | Floor |
| `takeaway` | Counter only — the floor plan disappears | Counter |

**Takeaway and delivery never appear on the floor plan.** A bag on the pass has
nothing to do with seating, and mixing the two ruined the one question the floor
exists to answer: *which tables need me?* Counter trade lives on its own screen,
with takeaway and delivery queued separately.

They stay traceable through **Orders**, which searches every transaction by order
number, customer name or phone, filtered by status, service type and date range —
plus receipt reprint. That is how a takeaway order is found when the customer rings
back, without it ever having occupied a table.

When **"takeaway is paid when the order is sent"** is on (default), the counter's
main button becomes *Send & take payment*: it fires the kitchen tickets and opens
the tender sheet in one pass. The payment sheet only opens **if every kitchen ticket
actually printed** — taking money for food the kitchen never heard about is the
worst outcome available here.

## Managing the menu

The **Menu** screen is full CRUD for items and categories: price, category, station,
kitchen name, tax flag, and which modifier groups an item offers. Two safety
properties hold:

- **Editing a price never restates an existing bill.** `order_items` snapshots the
  name and unit price when a line is rung in, so a mid-service price change cannot
  alter an open check or rewrite yesterday's takings. Verified in the smoke test.
- **Nothing is ever hard-deleted.** Removing an item or category hides it, keeping
  the sales history intact and letting a seasonal dish come back. Retiring a
  category hides its items too, so no orphan stays sellable.

**86 it** toggles an item off sale in one tap for a sell-out, with no dialog.

## How kitchen printing works

This is the part the rest of the system is arranged around.

**Every menu item belongs to a station** — `kitchen`, `grill`, `bar` or `dessert`.
**Every printer subscribes to one or more stations.** When a server taps *Send to
kitchen*:

1. The order's `pending` lines are claimed inside a single SQLite transaction and
   marked `fired` with a new round number. This happens *before* any byte reaches a
   socket, so a double-tap cannot print the same food twice.
2. The claimed lines are grouped by station.
3. Each group is rendered as its own ESC/POS ticket and sent to every printer
   serving that station — so the bar never prints steaks and the grill never
   prints mojitos. One order routinely yields two or three tickets.
4. Printing happens *outside* the transaction, because a jammed printer must never
   hold a write lock on the database during service.

Adding more food later fires a **new round** containing only the new lines. Removing
a line the kitchen has already seen does not delete it — it is marked `voided` and a
**CANCEL ticket** goes to that station, because the food may already be on the pass.

### Ticket design

Kitchen tickets are built to be read from two metres away by someone whose hands are
full: quantity and item name in double-height bold, modifiers indented beneath,
notes in bold double-height (a missed `NO PEANUTS` is the worst possible bug), and
**no prices at all** — money is not the kitchen's concern.

### Transports

| Transport | Use for | Notes |
|---|---|---|
| `tcp` | LAN thermal printer, raw port 9100 | The normal choice; kitchen printers live on the wall, not cabled to the till |
| `cups` | USB/Bluetooth printer in the OS queue | Sent via `lp -o raw`, bypassing the driver |
| `preview` | No hardware | Ticket opens on screen — the whole flow is testable on a laptop |

The app ships configured for `preview`, so you can exercise everything before the
printers arrive. Point them at real IPs in **Settings → Printers**.

### Nothing fails silently

Every ticket becomes a row in `print_jobs` *before* it is sent, storing the exact
byte payload. A printer that is off, jammed or unplugged leaves a **failed job** with
a retry button and a badge that follows the operator across every screen — rather
than a ticket that silently never reached the kitchen. `Settings → Print log` can
re-send any job byte-for-byte.

Settings also warns when a station has **no printer assigned**, which is the single
most dangerous misconfiguration in a restaurant POS: orders get taken and never
cooked.

## Money

All amounts are integer cents end to end; floats never touch a total.
`computeTotals()` in `src/main/services/orders.ts` is the single authoritative
calculation, used by the check, the receipt and the reports alike:

```
subtotal       = sum of non-voided line totals
discount       = subtotal × discount%
service charge = (subtotal − discount) × service%
tax            = (subtotal − discount + service) × taxable-share × tax%
total          = subtotal − discount + service + tax
```

`taxable-share` prorates tax when a check mixes taxable and exempt items, so an
exempt item is not taxed through the service charge by the back door.

Orders keep the tax and service rates they were *opened* with, so a bill never
changes under a seated guest when someone edits Settings mid-service.

## Architecture

```
src/
  shared/types.ts     contract between both processes
  main/
    db/               schema as numbered migrations, + demo seed
    services/         orders (state machine), menu, printers, reports, settings
    printing/
      escpos.ts       hand-written ESC/POS command builder
      templates.ts    kitchen / void / receipt / test ticket layouts
      transports.ts   tcp, cups, preview
      service.ts      station routing, job queue, retries
    ipc.ts            the renderer's entire surface area
  renderer/src/screens/
    FloorScreen       tables (dine-in only)
    CounterScreen     takeaway + delivery queues
    OrderScreen       menu + check + fire/pay
    OrdersScreen      searchable transaction history
    MenuScreen        item + category management
  preload/index.ts    typed contextBridge (`window.pos`)
  renderer/           React UI
```

The renderer has `contextIsolation: true` and `nodeIntegration: false`. It never
touches SQL, sockets or the filesystem — everything goes through the typed IPC
surface, and every handler returns a structured `{ok, error}` so a cashier sees
"printer offline", not a stack trace.

## macOS notes

**Electron must be version 34 or newer on macOS 26.** Older Electron binaries
(including 31.x) are flagged by XProtect as malware and *deleted from disk* on
launch, with a "Malware Blocked and Moved to Bin" dialog. This project pins
Electron 44.

If you still hit Gatekeeper trouble running unsigned dev builds, enable your
terminal under **System Settings → Privacy & Security → Developer Tools**.

**`ELECTRON_RUN_AS_NODE`**: VS Code's integrated terminal sets this, which makes the
`electron` binary behave as plain Node and fail with
`Cannot read properties of undefined (reading 'whenReady')`. The npm scripts clear
it with `env -u ELECTRON_RUN_AS_NODE`.

Shipping to customers requires a Developer ID certificate and notarization;
`electron-builder` handles both once `CSC_LINK` and `APPLE_ID` are set.

## Demo data

First launch seeds a demo restaurant — 27 menu items across 6 categories, 15 tables
in 3 zones, 5 modifier groups, and 3 printers in preview mode. The seed is guarded on
an empty `categories` table, so it never overwrites a live menu.
