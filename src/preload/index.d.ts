import type { PosApi } from './index'

declare global {
  interface Window {
    pos: PosApi
  }
}
