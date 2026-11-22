/**
 * 磁极谜题 canvas renderer：极简纸面风——多米诺双格合并圆角块与边界、
 * + / - 大字（红 / 蓝）、绝缘灰格；四周行列提示 +/− 双数字（超标转红），
 * 同极相邻与超标格红框、提示格金点；HUD 与过关 / 暂停 overlay。无状态，
 * 全部状态由调用方持有，视觉件复用 ../theme.ts。
 */
import type { MagnetsPuzzle } from './logic.ts'
import { PLUS, MINUS, NEUTRAL, countsOf } from './logic.ts'
import { THEME, drawBackground, drawOverlay, glow, hudPair, noGlow, roundRectPath } from '../theme.ts'

export const HUD_H = 32
export const GAP = 6
export const TOP_CLUE_H = 36
export const LEFT_CLUE_W = 44
export const BOTTOM_H = 20
/** 格边长随盘面收缩，保证整盘含边距不越界。 */
export function cellSize(size: number): number {
  return size <= 6 ? 50 : size <= 7 ? 46 : size <= 8 ? 42 : size <= 9 ? 38 : 34
}
export function boardW(size: number): number {
  return size * cellSize(size) + (size - 1) * GAP
}
export function logicalW(size: number): number {
  return LEFT_CLUE_W + GAP + boardW(size) + GAP
}
export function logicalH(size: number): number {
  return HUD_H + TOP_CLUE_H + GAP + boardW(size) + BOTTOM_H
}
export const BOARD_X = LEFT_CLUE_W + GAP
export const BOARD_Y = HUD_H + TOP_CLUE_H + GAP

/** 格左上角逻辑坐标。 */
export function cellOrigin(size: number, r: number, c: number): { x: number; y: number } {
  const cell = cellSize(size)
  return { x: BOARD_X + c * (cell + GAP), y: BOARD_Y + r * (cell + GAP) }
}

/** 逻辑坐标命中哪一格，界外返回 -1。 */
export function cellAt(size: number, x: number, y: number): number {
  const cell = cellSize(size)
  const c = Math.floor((x - BOARD_X) / (cell + GAP))
  const r = Math.floor((y - BOARD_Y) / (cell + GAP))
  if (r < 0 || r >= size || c < 0 || c >= size) return -1
  if (x - BOARD_X - c * (cell + GAP) > cell || y - BOARD_Y - r * (cell + GAP) > cell) return -1
  return r * size + c
}

/** 格中心逻辑坐标（粒子爆发）。 */
export function cellCenter(size: number, cellIdx: number): { x: number; y: number } {
  const { x, y } = cellOrigin(size, Math.floor(cellIdx / size), cellIdx % size)
  const cell = cellSize(size)
  return { x: x + cell / 2, y: y + cell / 2 }
}

const PLUS_C = '#f7768e'
const MINUS_C = '#7aa2f7'
const NEUTRAL_C = '#6c6c80'
const INSULATOR_C = '#33333f'

/** HUD 行数据。 */
export interface MagnetsHud {
  level: number
  levelTotal: number
  hintsLeft: number
  time: string
}

/**
 * 绘制一帧。
 * @param marks - 玩家标注数组（0 空 1 正 2 负 3 中性）。
 * @param conflicts - 冲突格（红框）。
 * @param revealed - 提示揭示过的格（金点）。
 * @param hud - HUD 行数据。
 * @param paused - 暂停 overlay。
 * @param winText - 过关 overlay 副标题，进行中为 null。
 */
export function renderMagnets(
  ctx: CanvasRenderingContext2D, puzzle: MagnetsPuzzle, marks: readonly number[],
  conflicts: readonly number[], revealed: readonly number[], hud: MagnetsHud,
  paused: boolean, winText: string | null,
): void {
  const size = puzzle.size
  const w = logicalW(size)
  const h = logicalH(size)
  const cell = cellSize(size)
  const counts = countsOf(puzzle, marks)
  const conflictSet = new Set(conflicts)
  const revealedSet = new Set(revealed)
  ctx.clearRect(0, 0, w, h)
  drawBackground(ctx, w, h)
  ctx.textBaseline = 'middle'

  // HUD：左关卡、中提示、右用时（三段互不相交，见核算）。
  hudPair(ctx, GAP / 2, 21, '关卡 ', hud.level + '/' + hud.levelTotal)
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = hud.hintsLeft > 0 ? THEME.gold : THEME.textMuted
  ctx.fillText('提示 H ×' + hud.hintsLeft, w / 2, 21)
  hudPair(ctx, w - GAP / 2, 21, '用时', hud.time, 'right')

  // 顶部列提示：上行 +、下行 −，超标转主题红。
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  for (let c = 0; c < size; c += 1) {
    const { x } = cellOrigin(size, 0, c)
    const cx = x + cell / 2
    ctx.fillStyle = counts.colPlus[c]! > puzzle.colPlus[c]! ? THEME.bad : PLUS_C
    ctx.fillText(String(puzzle.colPlus[c]), cx, HUD_H + 10)
    ctx.fillStyle = counts.colMinus[c]! > puzzle.colMinus[c]! ? THEME.bad : MINUS_C
    ctx.fillText(String(puzzle.colMinus[c]), cx, HUD_H + 26)
  }
  // 左侧行提示：右锚到盘边，+N 与 −N 相邻不重叠。
  ctx.font = '600 11px system-ui, sans-serif'
  ctx.textAlign = 'right'
  for (let r = 0; r < size; r += 1) {
    const { y } = cellOrigin(size, r, 0)
    const cy = y + cell / 2
    const minusText = '−' + puzzle.rowMinus[r]
    const plusText = '+' + puzzle.rowPlus[r]
    const minusW = ctx.measureText(minusText).width
    ctx.fillStyle = counts.rowMinus[r]! > puzzle.rowMinus[r]! ? THEME.bad : MINUS_C
    ctx.fillText(minusText, BOARD_X - 8, cy)
    ctx.fillStyle = counts.rowPlus[r]! > puzzle.rowPlus[r]! ? THEME.bad : PLUS_C
    ctx.fillText(plusText, BOARD_X - 12 - minusW, cy)
  }

  // 多米诺双格合并块（横 / 竖），绝缘单格灰块。
  ctx.lineWidth = 1.5
  for (let a = 0; a < size * size; a += 1) {
    const b = puzzle.partner[a]!
    if (puzzle.insulator[a]!) {
      const { x, y } = cellOrigin(size, Math.floor(a / size), a % size)
      ctx.fillStyle = INSULATOR_C
      roundRectPath(ctx, x, y, cell, cell, 8)
      ctx.fill()
      ctx.strokeStyle = THEME.panelEdge
      ctx.stroke()
      ctx.strokeStyle = THEME.textMuted
      ctx.beginPath()
      ctx.moveTo(x + cell * 0.3, y + cell * 0.3)
      ctx.lineTo(x + cell * 0.7, y + cell * 0.7)
      ctx.moveTo(x + cell * 0.7, y + cell * 0.3)
      ctx.lineTo(x + cell * 0.3, y + cell * 0.7)
      ctx.stroke()
      continue
    }
    if (b < a) continue
    const ra = Math.floor(a / size); const ca = a % size
    const oa = cellOrigin(size, ra, ca)
    const bw = b === a + 1 ? cell * 2 + GAP : cell
    const bh = b === a + 1 ? cell : cell * 2 + GAP
    ctx.fillStyle = THEME.panel
    roundRectPath(ctx, oa.x, oa.y, bw, bh, 8)
    ctx.fill()
    ctx.strokeStyle = THEME.panelEdge
    ctx.stroke()
  }

  // 标注：+ / − 大字、中性圆点。
  ctx.textAlign = 'center'
  for (let cellIdx = 0; cellIdx < size * size; cellIdx += 1) {
    if (puzzle.insulator[cellIdx]!) continue
    const { x, y } = cellOrigin(size, Math.floor(cellIdx / size), cellIdx % size)
    const cx = x + cell / 2
    const cy = y + cell / 2
    const mark = marks[cellIdx]
    if (mark === PLUS || mark === MINUS) {
      ctx.font = 'bold ' + Math.round(cell * 0.55) + 'px system-ui, sans-serif'
      ctx.fillStyle = mark === PLUS ? PLUS_C : MINUS_C
      glow(ctx, ctx.fillStyle, 6)
      ctx.fillText(mark === PLUS ? '+' : '−', cx, cy + 1)
      noGlow(ctx)
    } else if (mark === NEUTRAL) {
      ctx.beginPath()
      ctx.arc(cx, cy, cell * 0.16, 0, Math.PI * 2)
      ctx.fillStyle = NEUTRAL_C
      ctx.fill()
    }
    if (conflictSet.has(cellIdx)) {
      ctx.strokeStyle = THEME.bad
      ctx.lineWidth = 2.5
      roundRectPath(ctx, x + 1, y + 1, cell - 2, cell - 2, 7)
      ctx.stroke()
      ctx.lineWidth = 1.5
    }
    if (revealedSet.has(cellIdx)) {
      ctx.beginPath()
      ctx.arc(x + cell - 6, y + 6, 3, 0, Math.PI * 2)
      ctx.fillStyle = THEME.gold
      ctx.fill()
    }
  }

  // 底部常驻速览一行。
  ctx.font = '11px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('磁铁一正一负 · 同极不相邻 · 计数须吻合 · H提示 R重开 P暂停', w / 2, h - BOTTOM_H / 2)

  if (winText !== null) {
    drawOverlay(ctx, w, h, '过关', winText, THEME.good)
  } else if (paused) {
    drawOverlay(ctx, w, h, '已暂停', '按 P 继续', THEME.text)
  }
}
