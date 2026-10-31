/**
 * 数回 canvas renderer: the n×n grid with numbered island anchors (white
 * cells with the island size), player-shaded sea cells, a cursor ring, and
 * win/pause overlays. Stateless — state is caller-owned; uses the shared
 * visual kit (../theme.ts).
 */
import type { NuriPuzzle } from './logic.ts'
import { THEME, accent, drawBackground, drawOverlay, glow, hudPair, noGlow, roundRectPath } from '../theme.ts'

export const HUD_H = 32
export const GAP = 6
/** Cell edge shrinks with board size so the whole field fits the canvas. */
export function cellSize(size: number): number {
  return size <= 6 ? 52 : size <= 8 ? 44 : 38
}
export function boardW(size: number): number {
  const cell = cellSize(size)
  return size * cell + (size - 1) * GAP
}
export function logicalW(size: number): number {
  return boardW(size) + GAP
}
export function logicalH(size: number): number {
  return HUD_H + GAP + boardW(size) + GAP + 16
}

/** Top-left corner of cell (r, c) in logical space. */
export function cellOrigin(size: number, r: number, c: number): { x: number; y: number } {
  const cell = cellSize(size)
  return { x: GAP / 2 + c * (cell + GAP), y: HUD_H + GAP / 2 + r * (cell + GAP) }
}

/** Which cell a logical-space point lands on, or -1. */
export function cellAt(size: number, x: number, y: number): number {
  const cell = cellSize(size)
  const origin = cellOrigin(size, 0, 0)
  const c = Math.floor((x - origin.x) / (cell + GAP))
  const r = Math.floor((y - origin.y) / (cell + GAP))
  if (r < 0 || r >= size || c < 0 || c >= size) return -1
  const inX = x - origin.x - c * (cell + GAP)
  const inY = y - origin.y - r * (cell + GAP)
  if (inX > cell || inY > cell) return -1
  return r * size + c
}

/** Center of a cell in logical space (particle bursts). */
export function cellCenter(size: number, cellIdx: number): { x: number; y: number } {
  const { x, y } = cellOrigin(size, Math.floor(cellIdx / size), cellIdx % size)
  const cell = cellSize(size)
  return { x: x + cell / 2, y: y + cell / 2 }
}

/**
 * Draw one frame.
 * @param blacks - player-shaded cells.
 * @param cursor - focused cell, or -1 to hide the ring.
 * @param paused - show the pause overlay.
 * @param winText - level-clear overlay subtitle, or null while playing.
 */
export function renderNuri(
  ctx: CanvasRenderingContext2D, puzzle: NuriPuzzle, blacks: ReadonlySet<number>,
  cursor: number, paused: boolean, winText: string | null,
): void {
  const size = puzzle.size
  const w = logicalW(size)
  const h = logicalH(size)
  const cell = cellSize(size)
  ctx.clearRect(0, 0, w, h)
  drawBackground(ctx, w, h)

  hudPair(ctx, GAP / 2, 21, '已涂 ', String(blacks.size))
  hudPair(ctx, w - GAP / 2, 21, '规则', '岛=数', 'right')

  ctx.font = '700 ' + Math.floor(cell * 0.42) + 'px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let cellIdx = 0; cellIdx < size * size; cellIdx += 1) {
    const { x, y } = cellOrigin(size, Math.floor(cellIdx / size), cellIdx % size)
    const number = puzzle.numbers.get(cellIdx)
    const isBlack = blacks.has(cellIdx)
    if (isBlack) {
      ctx.fillStyle = '#0c0c14'
      roundRectPath(ctx, x, y, cell, cell, 8)
      ctx.fill()
      ctx.strokeStyle = THEME.panelEdge
      ctx.lineWidth = 1
      ctx.stroke()
    } else {
      ctx.fillStyle = number !== undefined ? accent(2) + '2e' : THEME.panel
      roundRectPath(ctx, x, y, cell, cell, 8)
      ctx.fill()
      ctx.strokeStyle = cursor === cellIdx ? THEME.text : THEME.panelEdge
      ctx.lineWidth = cursor === cellIdx ? 2.5 : 1
      if (cursor === cellIdx) glow(ctx, THEME.text, 8)
      ctx.stroke()
      noGlow(ctx)
      if (number !== undefined) {
        ctx.fillStyle = THEME.text
        ctx.fillText(String(number), x + cell / 2, y + cell / 2 + 1)
      }
    }
  }

  if (winText !== null) {
    drawOverlay(ctx, w, h, '过关', winText, THEME.good)
  } else if (paused) {
    drawOverlay(ctx, w, h, '已暂停', '按 P 继续', THEME.text)
  }
}
