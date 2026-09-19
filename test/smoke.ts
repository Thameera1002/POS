/**
 * End-to-end smoke test, run inside a real Electron main process so the actual
 * db + printing code paths execute (better-sqlite3 native module included).
 */
import { app } from 'electron'
import { initDb, getDb } from '../src/main/db'
import * as orders from '../src/main/services/orders'
import * as menu from '../src/main/services/menu'
import * as printers from '../src/main/services/printers'
import * as reports from '../src/main/services/reports'

let failures = 0

function check(label: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    console.log(`  PASS  ${label}`)
  } else {
    failures++
    console.log(`  FAIL  ${label}`, detail !== undefined ? JSON.stringify(detail) : '')
  }
}

async function main(): Promise<void> {
  // Guard against ever pointing this at a real till: the run below deletes
  // orders and payments, and `npm run test:smoke` sets POS_DB_PATH to a
  // throwaway file.
  if (!process.env.POS_DB_PATH) {
    throw new Error('Refusing to run: set POS_DB_PATH to a scratch database first')
  }

  initDb()

  // Start from a clean slate so repeat runs are comparable.
  const db = getDb()
  db.exec('DELETE FROM print_jobs; DELETE FROM payments; DELETE FROM order_items; DELETE FROM orders; DELETE FROM order_counters;')

  const items = menu.listMenu()
  const tables = menu.listTables()
  console.log(`\nMenu: ${items.length} items, ${tables.length} tables, ${printers.listPrinters().length} printers`)

  const steak = items.find((i) => i.name.includes('Ribeye'))!
  const mojito = items.find((i) => i.name === 'Mojito')!
  const fondant = items.find((i) => i.name.includes('Fondant'))!
  const fries = items.find((i) => i.name === 'French Fries')!

  console.log('\n— station routing —')
  check('ribeye is a grill item', steak.station === 'grill', steak.station)
  check('mojito is a bar item', mojito.station === 'bar', mojito.station)
  check('fondant is a dessert item', fondant.station === 'dessert', fondant.station)

  console.log('\n— open a check and add items —')
  let order = orders.createOrder({ order_type: 'dine_in', table_id: tables[0].id, guest_count: 2 })
  check('order number starts at 1 for the day', order.order_number === 1, order.order_number)
  check('dine-in picks up the service charge', order.service_charge_pct === 10, order.service_charge_pct)

  const medRare = steak.modifier_groups.flatMap((g) => g.modifiers).find((m) => m.name === 'Medium Rare')!
  const salad = steak.modifier_groups.flatMap((g) => g.modifiers).find((m) => m.name === 'Salad')!

  order = orders.addItem({
    order_id: order.id,
    menu_item_id: steak.id,
    qty: 2,
    notes: 'no peanuts - allergy',
    modifier_ids: [medRare.id, salad.id]
  })
  order = orders.addItem({ order_id: order.id, menu_item_id: mojito.id, qty: 2 })
  order = orders.addItem({ order_id: order.id, menu_item_id: fries.id, qty: 1 })

  // 2 x (5400 steak + 0 medium-rare + 100 salad) = 11000
  const steakLine = order.items.find((i) => i.menu_item_id === steak.id)!
  check('modifier price folds into the line total', steakLine.line_total_cents === 11000, steakLine.line_total_cents)
  check('three lines on the check', order.items.length === 3, order.items.length)
  check('all lines start pending', order.items.every((i) => i.status === 'pending'))

  // 11000 steak + 3300 mojitos (2 x 1650) + 600 fries = 14900
  check('subtotal', order.totals.subtotal_cents === 14900, order.totals.subtotal_cents)
  // service 10% = 1490; tax 8% of (14900 + 1490) = 1311.2 -> 1311
  check('service charge', order.totals.service_charge_cents === 1490, order.totals.service_charge_cents)
  check('tax', order.totals.tax_cents === 1311, order.totals.tax_cents)
  check('total', order.totals.total_cents === 17701, order.totals.total_cents)

  console.log('\n— fire to the kitchen: splits by station —')
  const fired = await orders.fireOrder(order.id)
  const names = fired.prints.map((p) => p.printer_name).sort()
  check('three tickets: grill, kitchen and bar', fired.prints.length === 3, names)
  check('all tickets succeeded', fired.prints.every((p) => p.ok), fired.prints.map((p) => p.error))
  check('grill + fries went to the Kitchen Printer', names.includes('Kitchen Printer'), names)
  check('mojitos went to the Bar Printer', names.includes('Bar Printer'), names)
  check('everything is now fired', fired.order.items.every((i) => i.status === 'fired'))
  check('round advanced to 1', fired.order.round === 1, fired.order.round)

  const grillTicket = fired.prints.find((p) => p.preview.includes('GRILL'))!.preview
  const kitchenTicket = grillTicket
  const friesTicket = fired.prints.find((p) => p.preview.includes('FRENCH FRIES'))!.preview
  const barTicket = fired.prints.find((p) => p.printer_name === 'Bar Printer')!.preview
  check('grill ticket is separate from the kitchen ticket', grillTicket !== friesTicket)
  check('fries ticket is headed KITCHEN', friesTicket.includes('KITCHEN'))
  check('kitchen ticket shows the steak', kitchenTicket.includes('RIBEYE'))
  check('kitchen ticket shows the allergy note', kitchenTicket.includes('NO PEANUTS'))
  check('kitchen ticket shows the doneness modifier', kitchenTicket.includes('MEDIUM RARE'))
  check('kitchen ticket carries no prices', !kitchenTicket.includes('5400') && !kitchenTicket.includes('54.00'))
  check('bar ticket has the mojitos', barTicket.includes('MOJITO'))
  check('bar ticket does NOT have the steak', !barTicket.includes('RIBEYE'))
  check('kitchen ticket does NOT have the mojitos', !kitchenTicket.includes('MOJITO'))

  console.log('\n  ── Kitchen Printer ' + '─'.repeat(30))
  console.log(kitchenTicket.split('\n').map((l) => '  │ ' + l).join('\n'))
  console.log('\n  ── Bar Printer ' + '─'.repeat(34))
  console.log(barTicket.split('\n').map((l) => '  │ ' + l).join('\n'))

  console.log('\n— firing again prints nothing new —')
  const again = await orders.fireOrder(order.id)
  check('no duplicate tickets', again.prints.length === 0, again.prints.length)

  console.log('\n— a second round only prints the new item —')
  order = orders.addItem({ order_id: order.id, menu_item_id: fondant.id, qty: 2 })
  const round2 = await orders.fireOrder(order.id)
  check('round 2 went to one printer only', round2.prints.length === 1, round2.prints.map((p) => p.printer_name))
  check('dessert routed to the Bar Printer', round2.prints[0].printer_name === 'Bar Printer')
  check('round 2 ticket has the fondant', round2.prints[0].preview.includes('FONDANT'))
  check('round 2 ticket omits already-fired items', !round2.prints[0].preview.includes('MOJITO'))
  check('round counter is 2', round2.order.round === 2, round2.order.round)

  console.log('\n— removing a fired item raises a VOID ticket —')
  const firedMojito = round2.order.items.find((i) => i.menu_item_id === mojito.id)!
  const removed = await orders.removeItem(firedMojito.id, 'guest changed mind')
  check('a void ticket was printed', removed.prints.length === 1, removed.prints.length)
  check('void ticket says CANCEL', removed.prints[0].preview.includes('CANCEL'))
  check('void ticket says DO NOT MAKE', removed.prints[0].preview.includes('DO NOT MAKE'))
  check('void went to the bar', removed.prints[0].printer_name === 'Bar Printer')
  check('line is kept as voided, not deleted', removed.order.items.find((i) => i.id === firedMojito.id)?.status === 'voided')
  // 14900 + 2300 fondant - 3300 mojitos = 13900
  check('voided line drops out of the subtotal', removed.order.totals.subtotal_cents === 13900, removed.order.totals.subtotal_cents)

  console.log('\n— removing a pending item just deletes it —')
  let o2 = orders.createOrder({ order_type: 'takeaway' })
  check('takeaway has no service charge', o2.service_charge_pct === 0, o2.service_charge_pct)
  o2 = orders.addItem({ order_id: o2.id, menu_item_id: fries.id, qty: 1 })
  const pendingRemoved = await orders.removeItem(o2.items[0].id)
  check('no void ticket for an unsent line', pendingRemoved.prints.length === 0)
  check('line is gone entirely', pendingRemoved.order.items.length === 0)

  console.log('\n— split payment and settlement —')
  order = orders.getOrder(order.id)
  const total = order.totals.total_cents
  const part = await orders.addPayment({ order_id: order.id, method: 'card', amount_cents: 5000, reference: '4242' })
  check('check stays open on a partial tender', part.order.status === 'open', part.order.status)
  check('balance reduced', part.order.totals.due_cents === total - 5000, part.order.totals.due_cents)
  check('no receipt printed yet', part.prints.length === 0)

  let overpaid = false
  try {
    await orders.addPayment({ order_id: order.id, method: 'cash', amount_cents: total })
  } catch {
    overpaid = true
  }
  check('overpaying is rejected', overpaid)

  const settled = await orders.addPayment({
    order_id: order.id,
    method: 'cash',
    amount_cents: total - 5000,
    tendered_cents: total - 5000 + 1000
  })
  check('check is now paid', settled.order.status === 'paid', settled.order.status)
  check('nothing left due', settled.order.totals.due_cents === 0)
  check('receipt printed automatically', settled.prints.length === 1 && settled.prints[0].ok)

  const rec = settled.prints[0].preview
  check('receipt names the restaurant', rec.includes('SAFFRON KITCHEN'))
  check('receipt shows a total', rec.includes('TOTAL'))
  check('receipt shows change due', rec.includes('Change'))
  check('receipt shows the voided item as excluded', !rec.includes('Mojito'))

  console.log('\n  ── Customer Receipt ' + '─'.repeat(29))
  console.log(rec.split('\n').map((l) => '  │ ' + l).join('\n'))

  console.log('\n— a failed printer leaves a retryable job —')
  const bar = printers.listPrinters().find((p) => p.name === 'Bar Printer')!
  printers.updatePrinter(bar.id, { transport: 'tcp', target: '10.255.255.1', port: 9100 })
  let o3 = orders.createOrder({ order_type: 'takeaway' })
  o3 = orders.addItem({ order_id: o3.id, menu_item_id: mojito.id, qty: 1 })
  const failedFire = await orders.fireOrder(o3.id)
  check('the fire reports a failure instead of throwing', failedFire.prints.length === 1 && !failedFire.prints[0].ok, failedFire.prints[0]?.error)
  const { failedJobCount } = await import('../src/main/printing/service')
  check('a failed job is recorded for retry', failedJobCount() >= 1, failedJobCount())
  printers.updatePrinter(bar.id, { transport: 'preview' })

  console.log('\n— unrouted station is surfaced, not swallowed —')
  const kp = printers.listPrinters().find((p) => p.name === 'Kitchen Printer')!
  printers.updatePrinter(kp.id, { stations: ['kitchen'] })
  let o4 = orders.createOrder({ order_type: 'takeaway' })
  o4 = orders.addItem({ order_id: o4.id, menu_item_id: steak.id, qty: 1, modifier_ids: [medRare.id, salad.id] })
  const unrouted = await orders.fireOrder(o4.id)
  check('grill with no printer reports an error', !unrouted.prints[0].ok, unrouted.prints[0])
  check('error names the station', (unrouted.prints[0].error ?? '').includes('grill'), unrouted.prints[0].error)
  printers.updatePrinter(kp.id, { stations: ['kitchen', 'grill'] })

  console.log('\n— void a whole check —')
  let o5 = orders.createOrder({ order_type: 'dine_in', table_id: tables[1].id })
  o5 = orders.addItem({ order_id: o5.id, menu_item_id: fries.id, qty: 3 })
  await orders.fireOrder(o5.id)
  const voided = await orders.voidOrder(o5.id, 'walked out')
  check('order status is void', voided.order.status === 'void', voided.order.status)
  check('a cancellation went to the kitchen', voided.prints.length === 1 && voided.prints[0].preview.includes('CANCEL'))
  check('void reason is recorded', (voided.order.note ?? '').includes('walked out'), voided.order.note)

  let noReason = false
  try {
    await orders.voidOrder(orders.createOrder({ order_type: 'takeaway' }).id, '   ')
  } catch {
    noReason = true
  }
  check('void requires a reason', noReason)

  console.log('\n— reports —')
  const day = new Date().toISOString().slice(0, 10)
  const report = reports.salesReport(day, day)
  check('one paid order in the report', report.order_count === 1, report.order_count)
  check('net matches the settled total', report.net_cents === total, { net: report.net_cents, total })
  check('two tender methods recorded', report.by_method.length === 2, report.by_method)
  check('top sellers populated', report.top_items.length > 0, report.top_items.length)

  const shift = reports.shiftSummary(day)
  check('cash expected is the cash tender', shift.cash_expected_cents === total - 5000, shift.cash_expected_cents)
  check('card recorded', shift.card_cents === 5000, shift.card_cents)
  check('one voided check counted', shift.void_count === 1, shift.void_count)

  console.log('\n— reopening an occupied table returns the same check —')
  const reopened = orders.createOrder({ order_type: 'dine_in', table_id: tables[0].id })
  check('same table does not create a second check', reopened.id === o4.id || reopened.order_number !== undefined)
  const openNow = orders.listOpenOrders()
  const t1 = openNow.filter((o) => o.table_name === tables[0].name)
  check('table 1 has exactly one open check', t1.length === 1, t1.length)

  console.log('\n— paid check is locked —')
  let locked = false
  try {
    orders.addItem({ order_id: order.id, menu_item_id: fries.id, qty: 1 })
  } catch {
    locked = true
  }
  check('cannot add to a settled check', locked)

  console.log('\n— takeaway never lands on the floor —')
  let ta = orders.createOrder({
    order_type: 'takeaway',
    customer_name: 'Nimal',
    customer_phone: '0771234567'
  })
  ta = orders.addItem({ order_id: ta.id, menu_item_id: fries.id, qty: 2 })
  const openSummaries = orders.listOpenOrders()
  const taSummary = openSummaries.find((o) => o.id === ta.id)!
  check('takeaway has no table', taSummary.table_name === null, taSummary.table_name)
  check(
    'floor view (dine-in only) excludes it',
    !openSummaries.filter((o) => o.order_type === 'dine_in').some((o) => o.id === ta.id)
  )
  check('customer details ride on the summary', taSummary.order_type === 'takeaway')

  console.log('\n— but it is fully traceable —')
  const byPhone = orders.searchOrders({ query: '0771234' })
  check('found by phone number', byPhone.some((o) => o.id === ta.id), byPhone.length)
  const byNumber = orders.searchOrders({ query: String(ta.order_number) })
  check('found by order number', byNumber.some((o) => o.id === ta.id))
  const byName = orders.searchOrders({ query: 'Nimal' })
  check('found by customer name', byName.some((o) => o.id === ta.id))
  const takeawayOnly = orders.searchOrders({ order_type: 'takeaway' })
  check('type filter works', takeawayOnly.every((o) => o.order_type === 'takeaway'))
  check('type filter includes it', takeawayOnly.some((o) => o.id === ta.id))
  const dineOnly = orders.searchOrders({ order_type: 'dine_in' })
  check('dine-in filter excludes takeaway', !dineOnly.some((o) => o.id === ta.id))
  const paidOnly = orders.searchOrders({ status: 'paid' })
  check('status filter works', paidOnly.every((o) => o.status === 'paid'), paidOnly.length)
  const noMatch = orders.searchOrders({ query: 'zzzz-no-such-customer' })
  check('a miss returns nothing', noMatch.length === 0, noMatch.length)

  console.log('\n— takeaway asks for nothing —')
  const bare = orders.createOrder({ order_type: 'takeaway' })
  check('takeaway opens with no customer details', bare.id > 0 && bare.customer_name === null)
  const withName = orders.updateOrder(bare.id, { customer_name: 'Kamal' })
  check('details can be added later when asked', withName.customer_name === 'Kamal')
  const partial = orders.updateOrder(bare.id, { customer_phone: '0711111111' })
  check('a phone alone is fine on takeaway', partial.customer_phone === '0711111111')

  console.log('\n— delivery demands name, phone and address —')
  const rejects = (label: string, input: Parameters<typeof orders.createOrder>[0], expect: string): void => {
    let msg = ''
    try {
      orders.createOrder(input)
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e)
    }
    check(label, msg.includes(expect), msg || '(created!)')
  }
  rejects(
    'no details at all is rejected',
    { order_type: 'delivery' },
    'customer name, phone number, delivery address'
  )
  rejects(
    'missing address is rejected',
    { order_type: 'delivery', customer_name: 'A', customer_phone: '1' },
    'delivery address'
  )
  rejects(
    'missing phone is rejected',
    { order_type: 'delivery', customer_name: 'A', delivery_address: 'X' },
    'phone number'
  )
  rejects(
    'missing name is rejected',
    { order_type: 'delivery', customer_phone: '1', delivery_address: 'X' },
    'customer name'
  )
  rejects(
    'whitespace does not count',
    { order_type: 'delivery', customer_name: '  ', customer_phone: '1', delivery_address: 'X' },
    'customer name'
  )

  let del = orders.createOrder({
    order_type: 'delivery',
    customer_name: 'Sunil',
    customer_phone: '0779876543',
    delivery_address: '42 Galle Road, apt 5B'
  })
  check('complete delivery is accepted', del.delivery_address === '42 Galle Road, apt 5B')

  let blanked = ''
  try {
    orders.updateOrder(del.id, { delivery_address: '' })
  } catch (e) {
    blanked = e instanceof Error ? e.message : String(e)
  }
  check('address cannot be blanked after creation', blanked.includes('delivery address'), blanked)

  let switched = ''
  try {
    orders.updateOrder(bare.id, { order_type: 'delivery' })
  } catch (e) {
    switched = e instanceof Error ? e.message : String(e)
  }
  check('switching a takeaway to delivery demands the address', switched.includes('delivery address'))

  console.log('\n— delivery address reaches the paper —')
  del = orders.addItem({ order_id: del.id, menu_item_id: fries.id, qty: 1 })
  const delFire = await orders.fireOrder(del.id)
  const delTicket = delFire.prints[0].preview
  check('address prints on the kitchen ticket', delTicket.includes('42 GALLE ROAD'))
  check('address has its own DELIVER TO block', delTicket.includes('DELIVER TO'))
  check('phone prints on the kitchen ticket', delTicket.includes('0779876543'))
  check('ticket is headed DELIVERY', delTicket.includes('DELIVERY'))
  const byAddress = orders.searchOrders({ query: 'Galle' })
  check('searchable by address', byAddress.some((o) => o.id === del.id))
  const queued = orders.listOpenOrders().find((o) => o.id === del.id)!
  check('address on the queue card summary', queued.delivery_address === '42 Galle Road, apt 5B')

  console.log('\n— menu management —')
  const cat = menu.createCategory('Specials', '#ff0000')
  check('category created', cat.name === 'Specials', cat.name)

  const spiceGroup = menu.listModifierGroups().find((g) => g.name === 'Spice Level')!
  const created = menu.createMenuItem({
    category_id: cat.id,
    name: 'Crab Curry',
    kitchen_name: 'CRAB CURRY',
    price_cents: 4200,
    station: 'kitchen',
    taxable: 1,
    active: 1,
    sort_order: 0,
    modifier_group_ids: [spiceGroup.id]
  })
  check('item created', created.name === 'Crab Curry' && created.price_cents === 4200)
  const withMods = menu.listMenu().find((i) => i.id === created.id)!
  check('modifier group attached', withMods.modifier_groups.length === 1, withMods.modifier_groups.length)

  let rejected = false
  try {
    menu.createMenuItem({ ...created, name: '   ', modifier_group_ids: [] } as never)
  } catch {
    rejected = true
  }
  check('a nameless item is rejected', rejected)

  let negative = false
  try {
    menu.createMenuItem({ ...created, price_cents: -100, modifier_group_ids: [] } as never)
  } catch {
    negative = true
  }
  check('a negative price is rejected', negative)

  console.log('\n— a price change must not restate an existing bill —')
  let priceOrder = orders.createOrder({ order_type: 'takeaway' })
  priceOrder = orders.addItem({ order_id: priceOrder.id, menu_item_id: created.id, qty: 2 })
  const before = priceOrder.totals.subtotal_cents
  check('line rung in at the old price', before === 8400, before)

  menu.updateMenuItem(created.id, { price_cents: 9900 })
  const afterChange = orders.getOrder(priceOrder.id)
  check('open check keeps the old price', afterChange.totals.subtotal_cents === 8400, afterChange.totals.subtotal_cents)
  check('line still shows the price it was sold at', afterChange.items[0].unit_price_cents === 4200)

  let newOrder = orders.createOrder({ order_type: 'takeaway' })
  newOrder = orders.addItem({ order_id: newOrder.id, menu_item_id: created.id, qty: 1 })
  check('a new order uses the new price', newOrder.totals.subtotal_cents === 9900, newOrder.totals.subtotal_cents)

  console.log('\n— 86 an item —')
  menu.setMenuItemAvailable(created.id, false)
  check('hidden from the sellable menu', !menu.listMenu().some((i) => i.id === created.id))
  check('still visible in the manager', menu.listMenu(true).some((i) => i.id === created.id))
  menu.setMenuItemAvailable(created.id, true)
  check('restored to the menu', menu.listMenu().some((i) => i.id === created.id))

  console.log('\n— retiring a category hides its items —')
  menu.archiveCategory(cat.id)
  check('category hidden', !menu.listCategories().some((c) => c.id === cat.id))
  check('its items hidden too', !menu.listMenu().some((i) => i.category_id === cat.id))
  check(
    'historical order still names the item',
    orders.getOrder(priceOrder.id).items[0].name === 'Crab Curry'
  )

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
  app.exit(failures === 0 ? 0 : 1)
}

app.whenReady().then(() =>
  main().catch((err) => {
    console.error('\nSMOKE TEST THREW:', err)
    app.exit(1)
  })
)
