// The "agents" view of the band: savvy-progress's progress row (dithered bar,
// label pill, percent, the walking crab), redrawn in the ribbon's colours.
// Drawing code adapted from johnnyvizz/claude-kit plugins/savvy-progress.
//
// savvy-progress: Copyright (c) 2026 johnnyvizz. MIT License:
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions: The above copyright
// notice and this permission notice shall be included in all copies or
// substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS",
// WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
// THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
// FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
// TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR
// THE USE OR OTHER DEALINGS IN THE SOFTWARE.

import { EMPTY, MUTED, TEXT, svgDoc } from './cache-art'

export const ACCENT = '#8f8cf4'
export const DONE = '#5fbf8f'
export const ROW_H = 22
const BAR_H = 16
const CRAB_W = 26
const CELL = 3
const TICK = '#6b6656'
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"
const CLAY = '#D97757'
const INK = '#1F1E1D'

/** What the row shows: the current wave of subagents. */
export type CrewView = { title: string; done: number; running: number; total: number }

const isFinished = (c: CrewView): boolean => c.total > 0 && c.running === 0
const ratio = (c: CrewView): number => (c.total ? c.done / c.total : 0)
export const crewLabel = (c: CrewView): string =>
  c.total === 0 ? 'no subagents yet' : isFinished(c) ? `done ${c.done}/${c.total}` : `agents ${c.done}/${c.total}`
export const crewPercent = (c: CrewView): string => `${Math.round(ratio(c) * 100)}%`

// Deterministic noise so the dither does not shimmer between redraws.
const noise = (x: number, y: number): number => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return s - Math.floor(s)
}

export const xml = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

const charEm = (ch: string): number =>
  /[\s.,:;'|!il1()[\]]/.test(ch) ? 0.3 : /[A-Zmw@%]/.test(ch) ? 0.72 : 0.56
export const textWidth = (s: string, size: number): number => [...s].reduce((w, ch) => w + charEm(ch) * size, 0)
export const fitText = (s: string, size: number, maxW: number): string => {
  if (textWidth(s, size) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (textWidth(out + ch + '…', size) > maxW) break
    out += ch
  }
  return out + '…'
}

// Legs step and the body bobs in pure CSS while a subagent runs.
const CRAB_CSS = `<style>
.run .la{animation:st .5s steps(1) infinite}.run .lb{animation:st .5s steps(1) infinite -.25s}
.run .bd{animation:bob .5s steps(1) infinite -.125s}
@keyframes st{50%{transform:translateY(-1px)}}@keyframes bob{50%{transform:translateY(1px)}}
.t0,.t1,.t2,.t3{animation:tw 2.2s ease-in-out infinite}
.t1{animation-duration:2.8s;animation-delay:-.7s}.t2{animation-duration:1.9s;animation-delay:-1.3s}.t3{animation-duration:3.3s;animation-delay:-.4s}
@keyframes tw{0%,100%{opacity:1}50%{opacity:.3}}
.fin .t0,.fin .t1,.fin .t2,.fin .t3{animation:none}
@media (prefers-reduced-motion: reduce){.run *,.t0,.t1,.t2,.t3{animation:none!important}}
</style>`

const crab = (x: number, y: number, scale: number, isWalking: boolean): string => {
  const r = (cx: number, cy: number, w: number, h: number, c: string) =>
    `<rect x="${cx}" y="${cy}" width="${w}" height="${h}" fill="${c}"/>`
  const body = r(7, 10, 16, 12, CLAY) + r(3, 14, 4, 4, CLAY) + r(23, 14, 4, 4, CLAY) + r(9, 12, 2, 2, INK) + r(19, 12, 2, 2, INK)
  const la = r(7, 22, 2, 4, CLAY) + r(17, 22, 2, 4, CLAY)
  const lb = r(11, 22, 2, 4, CLAY) + r(21, 22, 2, 4, CLAY)
  return `<g transform="translate(${x},${y}) scale(${scale})" shape-rendering="crispEdges"><g class="${isWalking ? 'run' : ''}"><g class="bd">${body}</g><g class="la">${la}</g><g class="lb">${lb}</g></g></g>`
}

/** The whole row as one drawing, W px wide: title, bar with its pill, percent, crab. */
export const crewRowSvg = (c: CrewView, W: number): string => {
  const H = ROW_H
  const title = fitText(c.title, 13, Math.max(60, W * 0.4))
  const BAR_X = Math.round(16 + textWidth(title, 13) + 12)
  const BAR_W = Math.max(60, W - BAR_X - 46 - CRAB_W)
  const fin = isFinished(c)
  const color = fin ? DONE : ACCENT
  const y0 = (H - BAR_H) / 2
  const fillW = Math.round(BAR_W * ratio(c))
  const runW = c.total ? Math.round((BAR_W * Math.min(c.total, c.done + c.running)) / c.total) : 0

  // Dithered fill: sparse at the start, dense toward the head.
  const dots: string[] = []
  const cols = Math.floor(fillW / CELL)
  const rows = Math.floor(BAR_H / CELL)
  for (let x = 0; x < cols; x++) {
    const density = 0.35 + 0.6 * Math.pow(x / Math.max(1, cols), 1.2)
    for (let y = 0; y < rows; y++) {
      if (noise(x, y) < density) dots.push(`<rect class="t${Math.floor(noise(y, x) * 4)}" x="${x * CELL + 1}" y="${y * CELL + 1}" width="2" height="2"/>`)
    }
  }
  // Running, not yet finished: a faint second layer.
  const faint: string[] = []
  for (let x = cols; x < Math.floor(runW / CELL); x++) {
    for (let y = 0; y < rows; y++) {
      if (noise(x + 7, y + 3) < 0.2) faint.push(`<rect class="t${Math.floor(noise(y + 5, x) * 4)}" x="${x * CELL + 1}" y="${y * CELL + 1}" width="1.7" height="1.7"/>`)
    }
  }
  const ticks: string[] = []
  for (let i = 1; i < c.total; i++) {
    const x = Math.round((BAR_W * i) / c.total)
    if (x > fillW + 4) ticks.push(`<rect x="${x}" y="${BAR_H / 2 - 4}" width="1.5" height="8" rx="0.75"/>`)
  }

  // A pill wider than a short bar falls back to the bare count.
  const full = crewLabel(c)
  const text = c.total > 0 && 18 + full.length * 6.6 > BAR_W ? `${c.done}/${c.total}` : full
  const pillW = Math.min(BAR_W, Math.round(18 + text.length * 6.6))
  const pillX = Math.max(0, Math.min(BAR_W - pillW, fillW - pillW))
  const pill = c.total === 0
    ? `<text x="10" y="${BAR_H / 2 + 4}" font-family="${FONT}" font-size="11" fill="${MUTED}">${xml(text)}</text>`
    : `<rect x="${pillX}" width="${pillW}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${color}"/>` +
      `<text x="${pillX + pillW / 2}" y="${BAR_H / 2 + 4}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="600" fill="#ffffff">${xml(text)}</text>`

  const body =
    CRAB_CSS +
    `<defs><clipPath id="c"><rect width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/></clipPath></defs>` +
    `<g class="${fin ? 'fin' : ''}">` +
    `<circle cx="5" cy="${H / 2}" r="4" fill="${color}"/>` +
    `<text x="16" font-family="${FONT}" y="${H / 2 + 4.5}" font-size="13" font-weight="600" fill="${TEXT}">${xml(title)}</text>` +
    `<g transform="translate(${BAR_X},${y0})">` +
    `<rect width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${EMPTY}"/>` +
    `<g clip-path="url(#c)"><g fill="${color}">${dots.join('')}</g><g fill="${color}" opacity="0.45">${faint.join('')}</g><g fill="${TICK}">${ticks.join('')}</g></g>` +
    pill +
    `</g>` +
    `<text x="${W - CRAB_W - 6}" y="${H / 2 + 4.5}" text-anchor="end" font-family="${FONT}" font-size="12.5" fill="${MUTED}">${crewPercent(c)}</text>` +
    crab(W - CRAB_W + 1, 0, 0.8, c.running > 0) +
    `</g>`
  return svgDoc(W, H, body, false)
}
