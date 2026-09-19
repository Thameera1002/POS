import { create } from 'zustand'
import type {
  AddItemInput,
  AddPaymentInput,
  Category,
  CreateOrderInput,
  CustomerDetailsInput,
  DiningTable,
  MenuItemWithModifiers,
  Order,
  OrderSummary,
  PrintResult,
  Printer,
  Settings
} from '../../shared/types'

export type Screen =
  | 'floor'
  | 'takeaway'
  | 'delivery'
  | 'order'
  | 'orders'
  | 'menu'
  | 'reports'
  | 'settings'

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  message: string
  /** Print results attached to a toast, so the operator sees what reached where. */
  prints?: PrintResult[]
}

interface PosState {
  screen: Screen
  ready: boolean

  settings: Settings | null
  categories: Category[]
  menu: MenuItemWithModifiers[]
  tables: DiningTable[]
  printers: Printer[]

  openOrders: OrderSummary[]
  activeOrder: Order | null

  toasts: Toast[]
  /** Ticket text shown in the paper-preview modal (no-hardware mode). */
  preview: PrintResult[] | null
  busy: boolean

  bootstrap: () => Promise<void>
  go: (screen: Screen) => void
  refreshOpenOrders: () => Promise<void>
  refreshPrinters: () => Promise<void>
  /** Reloads the sellable menu after an edit in the menu manager. */
  refreshMenu: () => Promise<void>
  /** Where "home" is, given how this venue trades. */
  homeScreen: () => Screen

  /** @returns whether the order was created; a form can stay open on failure. */
  openTable: (input: CreateOrderInput) => Promise<boolean>
  loadOrder: (id: number) => Promise<void>
  closeOrder: () => void

  addItem: (input: Omit<AddItemInput, 'order_id'>) => Promise<void>
  setQty: (orderItemId: number, qty: number) => Promise<void>
  removeItem: (orderItemId: number, reason?: string) => Promise<void>
  patchOrder: (patch: Record<string, unknown>) => Promise<void>
  /** Adds or corrects who the order is for. Validation lives in the main process. */
  updateCustomer: (details: CustomerDetailsInput) => Promise<boolean>

  fire: () => Promise<boolean>
  reprintRound: (round: number) => Promise<void>
  printBill: () => Promise<void>
  pay: (input: Omit<AddPaymentInput, 'order_id'>) => Promise<void>
  removePayment: (paymentId: number) => Promise<void>
  voidOrder: (reason: string) => Promise<void>

  saveSettings: (patch: Partial<Settings>) => Promise<void>

  toast: (kind: Toast['kind'], message: string, prints?: PrintResult[]) => void
  dismiss: (id: number) => void
  showPreview: (prints: PrintResult[] | null) => void
}

let toastSeq = 0

export const usePos = create<PosState>((set, get) => ({
  screen: 'floor',
  ready: false,
  settings: null,
  categories: [],
  menu: [],
  tables: [],
  printers: [],
  openOrders: [],
  activeOrder: null,
  toasts: [],
  preview: null,
  busy: false,

  async bootstrap() {
    const [settings, categories, menu, tables, printers, openOrders] = await Promise.all([
      window.pos.settings.get(),
      window.pos.menu.categories(),
      window.pos.menu.items(),
      window.pos.menu.tables(),
      window.pos.printers.list(),
      window.pos.orders.open()
    ])
    set({ settings, categories, menu, tables, printers, openOrders, ready: true })

    // Preview-transport printers have nowhere to send paper, so the ticket is
    // shown on screen instead. This is also how the flow is demoed/tested.
    window.pos.print.onPreview((result) => {
      set((s) => ({ preview: [...(s.preview ?? []), result] }))
    })
    window.pos.print.onFailed((result) => {
      get().toast('error', `${result.printer_name}: ${result.error ?? 'print failed'}`, [result])
    })
  },

  go: (screen) => set({ screen }),

  /**
   * A takeaway-only venue has no tables, so the floor plan is meaningless there
   * and the takeaway queue is home instead.
   */
  homeScreen() {
    return get().settings?.service_mode === 'takeaway' ? 'takeaway' : 'floor'
  },

  async refreshOpenOrders() {
    set({ openOrders: await window.pos.orders.open() })
  },

  async refreshPrinters() {
    set({ printers: await window.pos.printers.list() })
  },

  async refreshMenu() {
    const [categories, menu] = await Promise.all([
      window.pos.menu.categories(),
      window.pos.menu.items()
    ])
    set({ categories, menu })
  },

  async openTable(input) {
    let ok = false
    await guard(set, get, async () => {
      const order = await window.pos.orders.create(input)
      set({ activeOrder: order, screen: 'order' })
      await get().refreshOpenOrders()
      ok = true
    })
    return ok
  },

  async loadOrder(id) {
    await guard(set, get, async () => {
      set({ activeOrder: await window.pos.orders.get(id), screen: 'order' })
    })
  },

  closeOrder() {
    // Return to wherever the order came from: a table to the floor, a bag to
    // the takeaway queue, a driver run to the delivery queue.
    const type = get().activeOrder?.order_type
    const from: Screen = type === 'dine_in' ? 'floor' : type === 'delivery' ? 'delivery' : 'takeaway'
    set({ activeOrder: null, screen: from })
    void get().refreshOpenOrders()
  },

  async addItem(input) {
    const order = get().activeOrder
    if (!order) return
    await guard(set, get, async () => {
      set({ activeOrder: await window.pos.orders.addItem({ ...input, order_id: order.id }) })
    })
  },

  async setQty(orderItemId, qty) {
    await guard(set, get, async () => {
      if (qty <= 0) {
        await get().removeItem(orderItemId)
        return
      }
      set({ activeOrder: await window.pos.orders.updateItem({ order_item_id: orderItemId, qty }) })
    })
  },

  async removeItem(orderItemId, reason) {
    await guard(set, get, async () => {
      const { order, prints } = await window.pos.orders.removeItem(orderItemId, reason)
      set({ activeOrder: order })
      if (prints.length) get().toast('info', 'Cancellation sent to the kitchen', prints)
    })
  },

  async patchOrder(patch) {
    const order = get().activeOrder
    if (!order) return
    await guard(set, get, async () => {
      set({ activeOrder: await window.pos.orders.update(order.id, patch) })
      await get().refreshOpenOrders()
    })
  },

  async updateCustomer(details) {
    const order = get().activeOrder
    if (!order) return false
    let ok = false
    await guard(set, get, async () => {
      set({ activeOrder: await window.pos.orders.update(order.id, { ...details }) })
      await get().refreshOpenOrders()
      ok = true
    })
    return ok
  },

  /**
   * @returns whether every ticket reached a printer. The takeaway
   * send-and-settle flow uses this to refuse to open the payment sheet when the
   * kitchen never got the order.
   */
  async fire() {
    const order = get().activeOrder
    if (!order) return false

    let ok = false
    await guard(set, get, async () => {
      const { order: updated, prints } = await window.pos.orders.fire(order.id)
      set({ activeOrder: updated })
      await get().refreshOpenOrders()

      if (!prints.length) {
        get().toast('info', 'Nothing new to send — the kitchen already has this order')
        ok = true
        return
      }
      const failed = prints.filter((p) => !p.ok)
      if (failed.length) {
        get().toast(
          'error',
          `${failed.length} of ${prints.length} kitchen tickets failed to print`,
          prints
        )
      } else {
        ok = true
        get().toast('success', `Sent to kitchen — ${describe(prints)}`, prints)
      }
    })
    return ok
  },

  async reprintRound(round) {
    const order = get().activeOrder
    if (!order) return
    await guard(set, get, async () => {
      const { prints } = await window.pos.orders.reprintRound(order.id, round)
      get().toast('info', `Reprinted round ${round}`, prints)
    })
  },

  async printBill() {
    const order = get().activeOrder
    if (!order) return
    await guard(set, get, async () => {
      const prints = await window.pos.orders.printBill(order.id)
      const failed = prints.filter((p) => !p.ok)
      failed.length
        ? get().toast('error', failed[0].error ?? 'Bill failed to print', prints)
        : get().toast('success', 'Bill printed', prints)
    })
  },

  async pay(input) {
    const order = get().activeOrder
    if (!order) return
    await guard(set, get, async () => {
      const { order: updated, prints } = await window.pos.orders.addPayment({
        ...input,
        order_id: order.id
      })
      set({ activeOrder: updated })
      await get().refreshOpenOrders()

      if (updated.status === 'paid') {
        get().toast('success', `Order ${updated.order_number} settled`, prints)
      } else {
        get().toast('info', 'Partial payment recorded', prints)
      }
    })
  },

  async removePayment(paymentId) {
    await guard(set, get, async () => {
      set({ activeOrder: await window.pos.orders.removePayment(paymentId) })
      await get().refreshOpenOrders()
    })
  },

  async voidOrder(reason) {
    const order = get().activeOrder
    if (!order) return
    await guard(set, get, async () => {
      const { prints } = await window.pos.orders.void(order.id, reason)
      get().toast('info', `Order ${order.order_number} voided`, prints)
      get().closeOrder()
    })
  },

  async saveSettings(patch) {
    await guard(set, get, async () => {
      set({ settings: await window.pos.settings.update(patch) })
      get().toast('success', 'Settings saved')
    })
  },

  toast(kind, message, prints) {
    const id = ++toastSeq
    set((s) => ({ toasts: [...s.toasts, { id, kind, message, prints }] }))
    // Errors stay until dismissed: a failed kitchen ticket must not scroll away
    // unnoticed while the server is looking at the next table.
    if (kind !== 'error') {
      setTimeout(() => get().dismiss(id), 4000)
    }
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  showPreview: (preview) => set({ preview })
}))

/** Runs an action with a busy flag, surfacing any error as a toast. */
async function guard(
  set: (partial: Partial<PosState>) => void,
  get: () => PosState,
  fn: () => Promise<void>
): Promise<void> {
  set({ busy: true })
  try {
    await fn()
  } catch (err) {
    get().toast('error', err instanceof Error ? err.message : String(err))
  } finally {
    set({ busy: false })
  }
}

function describe(prints: PrintResult[]): string {
  return prints.map((p) => p.printer_name).join(', ')
}
