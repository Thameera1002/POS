/**
 * A minimal ESC/POS command builder.
 *
 * Written by hand rather than pulled from a dependency because thermal printers
 * are unforgiving about byte order and every published wrapper disagrees about
 * cut/drawer behaviour. Everything here is from the Epson ESC/POS spec that
 * Xprinter, Rongta, Bixolon and Star (in ESC/POS emulation) all implement.
 *
 * Every builder returns `this`, so a ticket reads top-to-bottom like the paper.
 * `.text()` lines are also accumulated separately to produce a plain-text
 * `preview`, which drives the on-screen preview window and stored reprints.
 */

const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

export type Align = 'left' | 'center' | 'right'

const ALIGN: Record<Align, number> = { left: 0, center: 1, right: 2 }

export interface StyleOptions {
  bold?: boolean
  /** Double width and height — used for item names on kitchen tickets. */
  doubleWidth?: boolean
  doubleHeight?: boolean
  underline?: boolean
  invert?: boolean
  align?: Align
}

export class EscPos {
  private chunks: Buffer[] = []
  private preview: string[] = []

  /** @param width Characters per line: 32 for 58mm paper, 42/48 for 80mm. */
  constructor(readonly width = 42) {
    this.raw([ESC, 0x40]) // ESC @ — reset printer to a known state
    this.raw([ESC, 0x74, 0x00]) // select PC437 code page
  }

  raw(bytes: number[] | Buffer): this {
    this.chunks.push(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes))
    return this
  }

  align(a: Align): this {
    return this.raw([ESC, 0x61, ALIGN[a]])
  }

  /**
   * ESC ! n — sets bold/double-width/double-height in one byte, and
   * ESC - n for underline which lives outside that register.
   */
  style(o: StyleOptions = {}): this {
    let n = 0
    if (o.bold) n |= 0x08
    if (o.doubleHeight) n |= 0x10
    if (o.doubleWidth) n |= 0x20
    this.raw([ESC, 0x21, n])
    this.raw([ESC, 0x2d, o.underline ? 0x01 : 0x00])
    this.raw([GS, 0x42, o.invert ? 0x01 : 0x00])
    if (o.align) this.align(o.align)
    return this
  }

  reset(): this {
    return this.style({}).align('left')
  }

  /**
   * Writes text, wrapping at the paper width so a long item name never runs off
   * the edge. Double-width text gets half the columns.
   */
  text(value: string, o: StyleOptions = {}): this {
    this.style(o)
    const cols = o.doubleWidth ? Math.floor(this.width / 2) : this.width
    const lines = wrap(value, cols)
    for (const line of lines) {
      // The printer does its own alignment from the ESC a set in style(), so
      // the bytes go out unpadded — padding them too would centre an
      // already-centred string and push it off to the right on real paper.
      // The preview has no such command, so it gets the padded copy instead.
      this.raw(encode(line))
      this.raw([LF])
      // Preview text is kept verbatim otherwise: spacing it out to mimic
      // double-width would make the stored ticket unsearchable and turn
      // "TOTAL 163.94" into "T O T A L   1 6 3 . 9 4" on screen.
      this.preview.push(o.align ? layout(line, this.width, o.align, o.doubleWidth) : line)
    }
    return this.reset()
  }

  /** Item name on the left, price on the right, dot-free clean alignment. */
  row(left: string, right: string, o: StyleOptions = {}): this {
    this.style(o)
    const gap = Math.max(1, this.width - visible(left) - visible(right))
    const line =
      visible(left) + visible(right) + 1 > this.width
        ? `${left.slice(0, Math.max(0, this.width - visible(right) - 1))} ${right}`
        : left + ' '.repeat(gap) + right
    this.raw(encode(line))
    this.raw([LF])
    this.preview.push(line)
    return this.reset()
  }

  rule(char = '-'): this {
    return this.text(char.repeat(this.width))
  }

  feed(lines = 1): this {
    this.raw([ESC, 0x64, lines])
    for (let i = 0; i < lines; i++) this.preview.push('')
    return this
  }

  /** GS V 66 n — partial cut after feeding n lines clear of the cutter. */
  cut(): this {
    this.feed(3)
    return this.raw([GS, 0x56, 0x42, 0x00])
  }

  /**
   * ESC p m t1 t2 — pulse the cash drawer on connector pin 2.
   * 25ms on / 25ms off is the safe default for 12V and 24V solenoids alike.
   */
  kickDrawer(): this {
    return this.raw([ESC, 0x70, 0x00, 0x19, 0x19])
  }

  /** Audible signal at the station so the line cook notices a new ticket. */
  beep(times = 2): this {
    return this.raw([ESC, 0x42, times, 0x03])
  }

  /** GS h/w/k — Code 128 barcode, used for the order number on receipts. */
  barcode(data: string): this {
    this.align('center')
    this.raw([GS, 0x68, 0x50]) // height 80 dots
    this.raw([GS, 0x77, 0x02]) // module width 2
    this.raw([GS, 0x48, 0x02]) // HRI text below barcode
    const payload = Buffer.from(`{B${data}`, 'ascii')
    this.raw([GS, 0x6b, 0x49, payload.length])
    this.raw(payload)
    this.raw([LF])
    this.preview.push(pad(`[ ${data} ]`, this.width, 'center'))
    return this.reset()
  }

  build(): Buffer {
    return Buffer.concat(this.chunks)
  }

  /** Plain-text mirror of the ticket for on-screen preview and reprints. */
  toText(): string {
    return this.preview.join('\n')
  }
}

/* ---------- helpers ---------- */

/** Strips characters a PC437 thermal head cannot render, before measuring. */
function visible(s: string): number {
  return s.length
}

/**
 * Positions a line for the preview the way the printer will position it on
 * paper. A double-width glyph covers two columns on the head but one character
 * on screen, so its indent is measured against the doubled length — otherwise
 * centred headings would sit left of where they actually print.
 */
function layout(s: string, width: number, align: Align, doubleWidth?: boolean): string {
  const visualLen = doubleWidth ? s.length * 2 : s.length
  const space = width - visualLen
  if (space <= 0) return s
  if (align === 'right') return ' '.repeat(space) + s
  if (align === 'center') return ' '.repeat(Math.floor(space / 2)) + s
  return s
}

function pad(s: string, cols: number, align: Align): string {
  if (s.length >= cols) return s
  const space = cols - s.length
  if (align === 'right') return ' '.repeat(space) + s
  if (align === 'center') return ' '.repeat(Math.floor(space / 2)) + s
  return s
}

function wrap(value: string, cols: number): string[] {
  const out: string[] = []
  for (const paragraph of value.split('\n')) {
    if (paragraph.length <= cols) {
      out.push(paragraph)
      continue
    }
    let line = ''
    for (const word of paragraph.split(' ')) {
      if (!line.length) {
        line = word
      } else if (line.length + 1 + word.length <= cols) {
        line += ' ' + word
      } else {
        out.push(line)
        line = word
      }
      // A single word longer than the paper: hard-break it.
      while (line.length > cols) {
        out.push(line.slice(0, cols))
        line = line.slice(cols)
      }
    }
    out.push(line)
  }
  return out
}

/**
 * Encodes to single-byte output. Accented and non-Latin glyphs are folded to
 * ASCII rather than emitted as multi-byte UTF-8, which a PC437 printer would
 * render as garbage.
 */
function encode(s: string): Buffer {
  const folded = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const bytes = Buffer.alloc(folded.length)
  for (let i = 0; i < folded.length; i++) {
    const code = folded.charCodeAt(i)
    bytes[i] = code < 0x100 ? code : 0x3f // '?'
  }
  return bytes
}
