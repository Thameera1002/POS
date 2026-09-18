/// <reference types="vite/client" />
import type { PosApi } from '../../preload/index'

declare global {
  interface Window {
    pos: PosApi
  }
}
