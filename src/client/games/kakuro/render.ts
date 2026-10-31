/**
 * 数和 Kakuro canvas renderer: black clue cells split by a top-left to
 * bottom-right diagonal (the down sum upper-right, the across sum
 * lower-left), white entry cells with centered digits, a cursor ring, and
 * win/pause overlays. Stateless — all state is caller-owned; uses the shared
 * visual kit (../theme.ts).
 */
import type { KakuroPuzzle } from './logic.ts'
import { THEME, drawBackground, drawOverlay, glow, hudPair, noGlow, roundRectPath } from '../theme.ts'

export const HUD_H = 32
export const GAP = 4
/** Cell edge shrinks with board size so the whole field fits the canvas. */
export function cellSize(size: number): number {
  return size <= 6 ? 56 : size <= 8 ? 48 : 44
}
export function boardW(size: number): number {
  const cell = cellSize(size)
  return size * cell + (size - 1) * GAP
}
export function logicalW(size: number): number {
  return boardW(size) + 2 * GAP
}
export function logicalH(size: number): number {
  return HUD_H + GAP + boardW(size) + GAP + 14
}

/** Top-left corner of cell (r, c) in logical space. */
export function cellOrigin(size: number, r: number, c: number): { x: number; y: number } {
  const cell = cellSize(size)
  return { x: GAP + c * (cell + GAP), y: HUD_H + GAP / 2 + r * (cell + GAP) }
}

/** Which white cell a logical-space point lands on, or null (black cells too). */
export function cellAt(size: number, black: readonly (readonly boolean[])[], x: number, y: number): { r: number; c: number } | null {
  const cell = cellSize(size)
  const origin = cellOrigin(size, 0, 0)
  const c = Math.floor((x - origin.x) / (cell + GAP))
  const r = Math.floor((y - origin.y) / (cell + GAP))
  if (r < 0 || r >= size || c < 0 || c >= size) return null
  const inX = x - origin.x - c * (cell + GAP)
  const inY = y - origin.y - r * (cell + GAP)
  if (inX > cell || inY > cell) return null
  if (black[r]![c]) return null
  return { r, c }
}

/** Center of a cell in logical space (particle bursts). */
export function cellCenter(size: number, r: number, c: number): { x: number; y: number } {
  const { x, y } = cellOrigin(size, r, c)
  const cell = cellSize(size)
  return { x: x + cell / 2, y: y + cell / 2 }
}

/**
 * Draw one frame.
 * @param grid - player values (0 = empty; black cells ignored).
 * @param cursor - focused white cell, or null.
 * @param paused - show the pause overlay.
 * @param winText - level-clear overlay subtitle, or null while playing.
 */
export function renderKakuro(
  ctx: CanvasRenderingContext2D, puzzle: KakuroPuzzle,
  grid: readonly (readonly number[])[], cursor: { r: number; c: number } | null,
  paused: boolean, winText: string | null,
): void {
  const size = puzzle.size
  const w = logicalW(size)
  const h = logicalH(size)
  const cell = cellSize(size)
  ctx.clearRect(0, 0, w, h)
  drawBackground(ctx, w, h)

  let whites = 0
  let filled = 0
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (puzzle.black[r]![c]) continue
      whites += 1
      if (grid[r]![c]! > 0) filled += 1
    }
  }
  hudPair(ctx, GAP, 21, '已填 ', filled + '/' + whites)
  hudPair(ctx, w - GAP, 21, '规则', '段内不重复', 'right')

  ctx.textBaseline = 'middle'
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      const { x, y } = cellOrigin(size, r, c)
      const isBlack = puzzle.black[r]![c]
      roundRectPath(ctx, x, y, cell, cell, 8)
      if (isBlack) {
        ctx.fillStyle = '#26263a'
        ctx.fill()
        const across = puzzle.across.get(r * size + c)
        const down = puzzle.down.get(r * size + c)
        if (across !== undefined || down !== undefined) {
          ctx.strokeStyle = THEME.panelEdge
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.lineTo(x + cell, y + cell)
          ctx.stroke()
          ctx.font = '600 ' + Math.floor(cell * 0.26) + 'px system-ui, sans-serif'
          ctx.fillStyle = THEME.textMuted
          if (down !== undefined) {
            ctx.textAlign = 'right'
            ctx.fillText(String(down), x + cell - 3, y + cell * 0.27)
          }
          if (across !== undefined) {
            ctx.textAlign = 'left'
            ctx.fillText(String(across), x + 3, y + cell * 0.73)
          }
        }
        continue
      }
      const v = grid[r]![c]!
      ctx.fillStyle = THEME.panel
      ctx.fill()
      ctx.strokeStyle = THEME.panelEdge
      ctx.lineWidth = cursor !== null && cursor.r === r && cursor.c === c ? 2.5 : 1
      if (cursor !== null && cursor.r === r && cursor.c === c) glow(ctx, THEME.text, 8)
      ctx.stroke()
      noGlow(ctx)
      if (v > 0) {
        ctx.font = '700 ' + Math.floor(cell * 0.44) + 'px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillStyle = THEME.text
        ctx.fillText(String(v), x + cell / 2, y + cell / 2 + 1)
      }
    }
  }

  if (winText !== null) {
    drawOverlay(ctx, w, h, '过关', winText, THEME.good)
  } else if (paused) {
    drawOverlay(ctx, w, h, '已暂停', '按 P 继续', THEME.text)
  }
}
