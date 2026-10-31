/**
 * 摩天楼 canvas renderer: the n×n grid framed by the four clue strips
 * (top/bottom per column, left/right per row), prefilled givens locked in
 * accent color, a cursor ring, conflict highlight, and win/pause overlays.
 * Stateless — all state is caller-owned; uses the shared visual kit
 * (../theme.ts).
 */
import type { SkyPuzzle } from './logic.ts'
import { THEME, accent, drawBackground, drawOverlay, glow, hudPair, noGlow, roundRectPath } from '../theme.ts'

export const HUD_H = 32
export const GAP = 6
/** Cell edge shrinks with board size so the whole field fits the canvas. */
export function cellSize(size: number): number {
  return size <= 4 ? 60 : size <= 5 ? 52 : 46
}
/** Clue strip width on each of the four sides. */
export const CLUE = 30
export function boardW(size: number): number {
  const cell = cellSize(size)
  return size * cell + (size - 1) * GAP
}
export function logicalW(size: number): number {
  return boardW(size) + GAP + 2 * CLUE
}
export function logicalH(size: number): number {
  return HUD_H + CLUE + GAP + boardW(size) + GAP + CLUE + 14
}

/** Top-left corner of cell (r, c) in logical space. */
export function cellOrigin(size: number, r: number, c: number): { x: number; y: number } {
  const cell = cellSize(size)
  return { x: GAP / 2 + CLUE + c * (cell + GAP), y: HUD_H + GAP / 2 + CLUE + r * (cell + GAP) }
}

/** Which cell a logical-space point lands on, or null. */
export function cellAt(size: number, x: number, y: number): { r: number; c: number } | null {
  const cell = cellSize(size)
  const origin = cellOrigin(size, 0, 0)
  const c = Math.floor((x - origin.x) / (cell + GAP))
  const r = Math.floor((y - origin.y) / (cell + GAP))
  if (r < 0 || r >= size || c < 0 || c >= size) return null
  const inX = x - origin.x - c * (cell + GAP)
  const inY = y - origin.y - r * (cell + GAP)
  if (inX > cell || inY > cell) return null
  return { r, c }
}

/** Center of a cell in logical space (particle bursts). */
export function cellCenter(size: number, r: number, c: number): { x: number; y: number } {
  const { x, y } = cellOrigin(size, r, c)
  const cell = cellSize(size)
  return { x: x + cell / 2, y: y + cell / 2 }
}

/** Cells conflicting with a same-value peer in their row or column. */
export function findConflicts(size: number, grid: readonly (readonly number[])[]): Set<number> {
  const bad = new Set<number>()
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      const v = grid[r]![c]!
      if (v < 1) continue
      for (let c2 = 0; c2 < size; c2 += 1) {
        if (c2 !== c && grid[r]![c2] === v) { bad.add(r * size + c); bad.add(r * size + c2) }
      }
      for (let r2 = 0; r2 < size; r2 += 1) {
        if (r2 !== r && grid[r2]![c] === v) { bad.add(r * size + c); bad.add(r2 * size + c) }
      }
    }
  }
  return bad
}

/**
 * Draw one frame.
 * @param grid - player values (0 = empty).
 * @param cursor - focused cell, or null.
 * @param paused - show the pause overlay.
 * @param winText - level-clear overlay subtitle, or null while playing.
 */
export function renderSky(
  ctx: CanvasRenderingContext2D, puzzle: SkyPuzzle,
  grid: readonly (readonly number[])[], cursor: { r: number; c: number } | null,
  paused: boolean, winText: string | null,
): void {
  const size = puzzle.size
  const w = logicalW(size)
  const h = logicalH(size)
  const cell = cellSize(size)
  ctx.clearRect(0, 0, w, h)
  drawBackground(ctx, w, h)

  const filled = grid.flat().filter(v => v > 0).length
  hudPair(ctx, GAP / 2, 21, '已填 ', filled + '/' + size * size)
  hudPair(ctx, w - GAP / 2, 21, '楼高', '1-' + size, 'right')

  const conflicts = findConflicts(size, grid)
  ctx.font = '600 15px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // Column clues: top and bottom.
  for (let c = 0; c < size; c += 1) {
    const { x } = cellOrigin(size, 0, c)
    const col = Array.from({ length: size }, (_, r) => grid[r]![c]!)
    const topOk = col.every(v => v > 0) && visible(col) === puzzle.top[c]
    ctx.fillStyle = topOk ? THEME.good : THEME.text
    ctx.fillText(String(puzzle.top[c]), x + cell / 2, cellOrigin(size, 0, 0).y - GAP / 2 - 9)
    const bottomOk = col.every(v => v > 0) && visible([...col].reverse()) === puzzle.bottom[c]
    ctx.fillStyle = bottomOk ? THEME.good : THEME.text
    ctx.fillText(String(puzzle.bottom[c]), x + cell / 2, cellOrigin(size, size - 1, 0).y + cell + GAP / 2 + 9)
  }
  // Row clues: left and right.
  for (let r = 0; r < size; r += 1) {
    const { y } = cellOrigin(size, r, 0)
    const row = grid[r]!
    const leftOk = row.every(v => v > 0) && visible(row) === puzzle.left[r]
    ctx.fillStyle = leftOk ? THEME.good : THEME.text
    ctx.fillText(String(puzzle.left[r]), cellOrigin(size, 0, 0).x - GAP / 2 - 10, y + cell / 2)
    const rightOk = row.every(v => v > 0) && visible([...row].reverse()) === puzzle.right[r]
    ctx.fillStyle = rightOk ? THEME.good : THEME.text
    ctx.fillText(String(puzzle.right[r]), cellOrigin(size, 0, size - 1).x + cell + GAP / 2 + 10, y + cell / 2)
  }

  ctx.font = '700 ' + Math.floor(cell * 0.44) + 'px system-ui, sans-serif'
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      const { x, y } = cellOrigin(size, r, c)
      const cellIdx = r * size + c
      const given = puzzle.givens.get(cellIdx)
      const v = grid[r]![c]!
      const conflict = conflicts.has(cellIdx)
      ctx.fillStyle = (r + c) % 2 === 0 ? THEME.panel : accent(0) + '14'
      roundRectPath(ctx, x, y, cell, cell, 8)
      ctx.fill()
      ctx.strokeStyle = conflict ? THEME.bad : THEME.panelEdge
      ctx.lineWidth = cursor !== null && cursor.r === r && cursor.c === c ? 2.5 : 1
      if (cursor !== null && cursor.r === r && cursor.c === c) glow(ctx, THEME.text, 8)
      ctx.stroke()
      noGlow(ctx)
      if (v > 0) {
        ctx.fillStyle = given !== undefined ? accent(2) : (conflict ? THEME.bad : THEME.text)
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

function visible(vals: readonly number[]): number {
  let max = 0
  let count = 0
  for (const v of vals) {
    if (v > max) {
      max = v
      count += 1
    }
  }
  return count
}
