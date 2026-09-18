import { ipcMain } from 'electron'
import * as menu from './services/menu'
import * as orders from './services/orders'
import * as printers from './services/printers'
import * as reports from './services/reports'
import * as settings from './services/settings'
import * as printing from './printing/service'
import { listCupsQueues } from './printing/transports'

/**
 * The renderer's entire surface area. Every handler is wrapped so a thrown
 * error arrives in the UI as a readable message rather than an unhandled
 * rejection with a mangled stack — a cashier needs "printer offline", not
 * "Error invoking remote method".
 */
type Handler = (...args: never[]) => unknown

function handle(channel: string, fn: Handler): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await (fn as (...a: unknown[]) => unknown)(...args) }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[ipc] ${channel}: ${message}`)
      return { ok: false, error: message }
    }
  })
}

export function registerIpc(): void {
  /* menu & floor plan */
  handle('menu:categories', () => menu.listCategories())
  handle('menu:items', () => menu.listMenu())
  handle('menu:tables', () => menu.listTables())
  handle('menu:allItems', () => menu.listMenu(true))
  handle('menu:allCategories', () => menu.listAllCategories())
  handle('menu:modifierGroups', () => menu.listModifierGroups())
  handle('menu:createItem', (input) => menu.createMenuItem(input))
  handle('menu:updateItem', (id, patch) => menu.updateMenuItem(id, patch))
  handle('menu:archiveItem', (id) => menu.archiveMenuItem(id))
  handle('menu:restoreItem', (id) => menu.restoreMenuItem(id))
  handle('menu:setAvailable', (id, available) => menu.setMenuItemAvailable(id, available))
  handle('menu:createCategory', (name, color) => menu.createCategory(name, color))
  handle('menu:updateCategory', (id, patch) => menu.updateCategory(id, patch))
  handle('menu:archiveCategory', (id) => menu.archiveCategory(id))
  handle('menu:createTable', (name, seats, zone) => menu.createTable(name, seats, zone))
  handle('menu:archiveTable', (id) => menu.archiveTable(id))

  /* orders */
  handle('orders:list', (status) => orders.listOrders(status))
  handle('orders:search', (filter) => orders.searchOrders(filter))
  handle('orders:open', () => orders.listOpenOrders())
  handle('orders:get', (id) => orders.getOrder(id))
  handle('orders:create', (input) => orders.createOrder(input))
  handle('orders:update', (id, patch) => orders.updateOrder(id, patch))
  handle('orders:addItem', (input) => orders.addItem(input))
  handle('orders:updateItem', (input) => orders.updateItem(input))
  handle('orders:removeItem', (id, reason) => orders.removeItem(id, reason))
  handle('orders:fire', (id) => orders.fireOrder(id))
  handle('orders:reprintRound', (id, round) => orders.reprintRound(id, round))
  handle('orders:addPayment', (input) => orders.addPayment(input))
  handle('orders:removePayment', (id) => orders.removePayment(id))
  handle('orders:void', (id, reason) => orders.voidOrder(id, reason))
  handle('orders:printBill', (id) => orders.printBill(id))
  handle('orders:reprintReceipt', (id) => orders.reprintReceipt(id))

  /* printing */
  handle('printers:list', () => printers.listPrinters())
  handle('printers:create', (input) => printers.createPrinter(input))
  handle('printers:update', (id, patch) => printers.updatePrinter(id, patch))
  handle('printers:delete', (id) => printers.deletePrinter(id))
  handle('printers:test', (id) => printing.printTest(id))
  handle('printers:queues', () => listCupsQueues())
  handle('printers:openDrawer', () => printing.openDrawer())
  handle('print:jobs', (limit) => printing.listJobs(limit))
  handle('print:failedCount', () => printing.failedJobCount())
  handle('print:retry', (id) => printing.retryJob(id))
  handle('print:retryAll', () => printing.retryAllFailed())

  /* settings & reports */
  handle('settings:get', () => settings.getSettings())
  handle('settings:update', (patch) => settings.updateSettings(patch))
  handle('reports:sales', (from, to) => reports.salesReport(from, to))
  handle('reports:shift', (day) => reports.shiftSummary(day))
}
