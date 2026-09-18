import { contextBridge, ipcRenderer } from 'electron'
import type {
  AddItemInput,
  AddPaymentInput,
  Category,
  CreateOrderInput,
  DiningTable,
  MenuItem,
  MenuItemInput,
  MenuItemWithModifiers,
  Modifier,
  ModifierGroup,
  Order,
  OrderFilter,
  OrderSummary,
  PrintJob,
  PrintResult,
  Printer,
  SalesReport,
  Settings,
  UpdateItemInput
} from '../shared/types'

/** Envelope every main-process handler replies with. */
type Reply<T> = { ok: true; data: T } | { ok: false; error: string }

/**
 * Unwraps the envelope so callers can `await api.orders.fire(id)` and catch a
 * normal Error, while the main process keeps returning structured failures.
 */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const reply = (await ipcRenderer.invoke(channel, ...args)) as Reply<T>
  if (!reply.ok) throw new Error(reply.error)
  return reply.data
}

type FireResult = { order: Order; prints: PrintResult[] }

const api = {
  version: () => ipcRenderer.invoke('app:version') as Promise<string>,

  menu: {
    categories: () => call<Category[]>('menu:categories'),
    items: () => call<MenuItemWithModifiers[]>('menu:items'),
    tables: () => call<DiningTable[]>('menu:tables'),
    allItems: () => call<MenuItemWithModifiers[]>('menu:allItems'),
    allCategories: () => call<Category[]>('menu:allCategories'),
    modifierGroups: () =>
      call<(ModifierGroup & { modifiers: Modifier[] })[]>('menu:modifierGroups'),
    createItem: (input: MenuItemInput) => call<MenuItem>('menu:createItem', input),
    updateItem: (id: number, patch: Partial<MenuItemInput>) =>
      call<MenuItem>('menu:updateItem', id, patch),
    archiveItem: (id: number) => call<void>('menu:archiveItem', id),
    restoreItem: (id: number) => call<void>('menu:restoreItem', id),
    setAvailable: (id: number, available: boolean) =>
      call<MenuItem>('menu:setAvailable', id, available),
    createCategory: (name: string, color: string) =>
      call<Category>('menu:createCategory', name, color),
    updateCategory: (id: number, patch: Partial<Omit<Category, 'id'>>) =>
      call<Category>('menu:updateCategory', id, patch),
    archiveCategory: (id: number) => call<void>('menu:archiveCategory', id),
    createTable: (name: string, seats: number, zone: string) =>
      call<DiningTable>('menu:createTable', name, seats, zone),
    archiveTable: (id: number) => call<void>('menu:archiveTable', id)
  },

  orders: {
    list: (status?: 'open' | 'paid' | 'void') => call<OrderSummary[]>('orders:list', status),
    search: (filter: OrderFilter) => call<OrderSummary[]>('orders:search', filter),
    open: () => call<OrderSummary[]>('orders:open'),
    get: (id: number) => call<Order>('orders:get', id),
    create: (input: CreateOrderInput) => call<Order>('orders:create', input),
    update: (id: number, patch: Record<string, unknown>) => call<Order>('orders:update', id, patch),
    addItem: (input: AddItemInput) => call<Order>('orders:addItem', input),
    updateItem: (input: UpdateItemInput) => call<Order>('orders:updateItem', input),
    removeItem: (id: number, reason?: string) => call<FireResult>('orders:removeItem', id, reason),
    fire: (id: number) => call<FireResult>('orders:fire', id),
    reprintRound: (id: number, round: number) => call<FireResult>('orders:reprintRound', id, round),
    addPayment: (input: AddPaymentInput) => call<FireResult>('orders:addPayment', input),
    removePayment: (id: number) => call<Order>('orders:removePayment', id),
    void: (id: number, reason: string) => call<FireResult>('orders:void', id, reason),
    printBill: (id: number) => call<PrintResult[]>('orders:printBill', id),
    reprintReceipt: (id: number) => call<PrintResult[]>('orders:reprintReceipt', id)
  },

  printers: {
    list: () => call<Printer[]>('printers:list'),
    create: (input: Omit<Printer, 'id'>) => call<Printer>('printers:create', input),
    update: (id: number, patch: Partial<Omit<Printer, 'id'>>) =>
      call<Printer>('printers:update', id, patch),
    remove: (id: number) => call<void>('printers:delete', id),
    test: (id: number) => call<PrintResult>('printers:test', id),
    queues: () => call<string[]>('printers:queues'),
    openDrawer: () => call<PrintResult>('printers:openDrawer')
  },

  print: {
    jobs: (limit?: number) => call<PrintJob[]>('print:jobs', limit),
    failedCount: () => call<number>('print:failedCount'),
    retry: (id: number) => call<PrintResult>('print:retry', id),
    retryAll: () => call<PrintResult[]>('print:retryAll'),

    /** Fired when a `preview` transport printer "prints" — shows the ticket. */
    onPreview: (cb: (result: PrintResult) => void) => {
      const listener = (_e: unknown, payload: PrintResult): void => cb(payload)
      ipcRenderer.on('print:preview', listener)
      return () => ipcRenderer.removeListener('print:preview', listener)
    },

    /** Fired when any ticket fails to reach its printer. */
    onFailed: (cb: (result: PrintResult) => void) => {
      const listener = (_e: unknown, payload: PrintResult): void => cb(payload)
      ipcRenderer.on('print:failed', listener)
      return () => ipcRenderer.removeListener('print:failed', listener)
    }
  },

  settings: {
    get: () => call<Settings>('settings:get'),
    update: (patch: Partial<Settings>) => call<Settings>('settings:update', patch)
  },

  reports: {
    sales: (from: string, to: string) => call<SalesReport>('reports:sales', from, to),
    shift: (day: string) =>
      call<{
        day: string
        cash_expected_cents: number
        card_cents: number
        other_cents: number
        order_count: number
        void_count: number
        voided_item_cents: number
      }>('reports:shift', day)
  }
}

export type PosApi = typeof api

contextBridge.exposeInMainWorld('pos', api)
