/**
 * 记忆路径 TrailMemory 渲染：深色 6×6 网格；闪现阶段当前格脉冲、
 * 已闪路径格随时间渐暗（传送格标 ◆）、干扰格短促暗闪；输入阶段画
 * 复现轨迹连线、起点标记、错红对绿。布局矩形全部由本文件导出，
 * index.ts 用同一份布局做点击命中。说明按钮与帮助面板画在整个渲染
 * 函数的最末尾，永远盖在棋盘与 overlay 之上。
 */
import {
  THEME, accent, drawBackground, drawOverlay, glow, hudPair, noGlow, roundRectPath,
} from '../theme.ts'
import {
  GRID, currentEvent, eventDurationMs, type TrailMemoryState,
} from './logic.ts'

/** 逻辑画布尺寸（自适应缩放交给 fitCanvas 变换）。 */
export const LOGICAL_W = 520
export const LOGICAL_H = 600

/** 网格布局：72px 格 + 8px 缝，居中于 24px 边距内。 */
const CELL = 72
const GAP = 8
const BOARD_X = 24
const BOARD_Y = 64
const HUD_Y = 30
const HINT_Y = 578

/** 一个逻辑坐标矩形。 */
export interface Rect { x: number, y: number, w: number, h: number }

/** 说明按钮（60x24，右下角）。 */
export const HELP_BUTTON: Rect = { x: 436, y: 564, w: 60, h: 24 }

/**
 * 格下标（0..35）的绘制矩形。
 * @param cell - 格下标 = 行 × 6 + 列。
 * @returns 该格的逻辑矩形。
 */
export function cellRect(cell: number): Rect {
  const row = Math.floor(cell / GRID)
  const col = cell % GRID
  return { x: BOARD_X + col * (CELL + GAP), y: BOARD_Y + row * (CELL + GAP), w: CELL, h: CELL }
}

/**
 * 逻辑坐标点命中的格下标。
 * @param x - 逻辑横坐标。
 * @param y - 逻辑纵坐标。
 * @returns 格下标 0..35，未命中返回 -1。
 */
export function cellAt(x: number, y: number): number {
  for (let c = 0; c < GRID * GRID; c += 1) {
    const r = cellRect(c)
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return c
  }
  return -1
}

/**
 * 说明按钮是否被点中。
 * @param x - 逻辑横坐标。
 * @param y - 逻辑纵坐标。
 * @returns true 表示命中按钮矩形。
 */
export function helpButtonHit(x: number, y: number): boolean {
  return x >= HELP_BUTTON.x && x < HELP_BUTTON.x + HELP_BUTTON.w
    && y >= HELP_BUTTON.y && y < HELP_BUTTON.y + HELP_BUTTON.h
}

/** 渲染选项：阶段与动效标志（由 index.ts 持有）。 */
export interface RenderOptions {
  paused: boolean
  /** 说明面板是否展开。 */
  helpOpen: boolean
  /** 过关停顿期：刚走完的旧路径绿闪庆祝（null 表示非停顿期）。 */
  settleCells: number[] | null
  /** 最近错点格（红闪计时器 > 0 时非空）。 */
  wrongCell: number | null
}

/** 画一格底板：圆角深色面板 + 细边。 */
function drawCellBase(ctx: CanvasRenderingContext2D, r: Rect): void {
  roundRectPath(ctx, r.x, r.y, r.w, r.h, 10)
  ctx.fillStyle = THEME.panel
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
}

/**
 * 画一层格内高亮（半透明填充 + 辉光边）。
 * @param color - 高亮色。
 * @param alpha - 填充不透明度 0..1。
 */
function drawCellGlow(ctx: CanvasRenderingContext2D, r: Rect, color: string, alpha: number): void {
  if (alpha <= 0.01) return
  ctx.globalAlpha = alpha
  glow(ctx, color, 14)
  roundRectPath(ctx, r.x, r.y, r.w, r.h, 10)
  ctx.fillStyle = color
  ctx.fill()
  noGlow(ctx)
  ctx.globalAlpha = 1
}

/** 在格右上角画传送标记 ◆。 */
function drawTeleportMark(ctx: CanvasRenderingContext2D, r: Rect): void {
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = THEME.gold
  ctx.fillText('◆', r.x + r.w - 8, r.y + 20)
}

/** 闪现阶段：当前格脉冲 + 已闪路径格渐暗 + 干扰格暗闪。 */
function drawShowing(ctx: CanvasRenderingContext2D, state: TrailMemoryState): void {
  const cur = currentEvent(state)
  // 已闪过的路径格：越早越暗；同格只保留最近一次（路径格唯一）。
  for (let i = 0; i < state.showIndex && i < state.events.length; i += 1) {
    const ev = state.events[i]!
    if (!ev.isPath) continue
    const alpha = Math.max(0.12, 0.55 - (state.showIndex - i) * 0.08)
    drawCellGlow(ctx, cellRect(ev.cell), accent(0), alpha)
    if (ev.teleport) drawTeleportMark(ctx, cellRect(ev.cell))
  }
  if (cur === null) return
  const rect = cellRect(cur.cell)
  if (cur.isPath) {
    const dur = eventDurationMs(cur, state.round)
    const progress = Math.min(1, dur > 0 ? state.showElapsed / dur : 1)
    // 呼吸脉冲：亮度随事件内进度按正弦起伏。
    const pulse = 0.45 + 0.55 * Math.sin(Math.PI * progress)
    drawCellGlow(ctx, rect, cur.teleport ? THEME.gold : accent(0), 0.25 + 0.6 * pulse)
    if (cur.teleport) drawTeleportMark(ctx, rect)
  } else {
    // 干扰微闪：短促且明显更暗。
    drawCellGlow(ctx, rect, accent(4), 0.3)
  }
}

/** 输入阶段：起点标记、已点轨迹连线与对绿；错格红闪。 */
function drawInput(ctx: CanvasRenderingContext2D, state: TrailMemoryState, wrongCell: number | null): void {
  if (state.inputIndex >= 1) {
    // 已正确点过的格：绿显 + 中心连线。
    ctx.strokeStyle = accent(0)
    ctx.lineWidth = 3
    ctx.lineJoin = 'round'
    glow(ctx, accent(0), 8)
    ctx.beginPath()
    for (let i = 0; i < state.inputIndex; i += 1) {
      const r = cellRect(state.path[i]!)
      if (i === 0) ctx.moveTo(r.x + r.w / 2, r.y + r.h / 2)
      else ctx.lineTo(r.x + r.w / 2, r.y + r.h / 2)
    }
    ctx.stroke()
    noGlow(ctx)
    for (let i = 0; i < state.inputIndex; i += 1) {
      drawCellGlow(ctx, cellRect(state.path[i]!), THEME.good, 0.35)
    }
  }
  if (state.path.length > 0) {
    // 起点标记：高亮环 + 「起」。
    const r = cellRect(state.path[0]!)
    if (state.inputIndex === 0) drawCellGlow(ctx, r, accent(0), 0.18)
    ctx.strokeStyle = accent(0)
    ctx.lineWidth = 2
    roundRectPath(ctx, r.x + 3, r.y + 3, r.w - 6, r.h - 6, 8)
    ctx.stroke()
    ctx.font = '600 13px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = accent(0)
    ctx.fillText('起', r.x + r.w / 2, r.y + r.h / 2 + 5)
  }
  if (wrongCell !== null && wrongCell >= 0) {
    drawCellGlow(ctx, cellRect(wrongCell), THEME.bad, 0.5)
  }
}

/**
 * 整幅渲染：背景 → HUD → 网格 → 阶段高亮 → 底部提示 → 粒子 →
 * 暂停/结束 overlay → 说明按钮 → 帮助面板（最后两步永远最上层）。
 * @param ctx - 画布上下文（已带逻辑坐标变换）。
 * @param state - 对局状态。
 * @param opts - 阶段与动效标志。
 * @param particles - 可选粒子系统（过关庆祝）。
 * @param dtMs - 粒子推进毫秒。
 */
export function renderTrailMemory(
  ctx: CanvasRenderingContext2D,
  state: TrailMemoryState,
  opts: RenderOptions,
  particles?: { tick(ctx: CanvasRenderingContext2D, dtMs: number): void },
  dtMs = 16,
): void {
  drawBackground(ctx, LOGICAL_W, LOGICAL_H)
  ctx.textBaseline = 'alphabetic'

  // HUD：左命（随命数伸缩，左锚只缩短）、中轮/长度（定长语义，居中）、右得分（右锚）。
  hudPair(ctx, 24, HUD_Y, '命', state.lives > 0 ? '♥'.repeat(state.lives) : '—')
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = THEME.text
  ctx.fillText('轮 ' + String(Math.max(1, state.round)) + ' · 长度 ' + String(state.path.length), LOGICAL_W / 2, HUD_Y)
  hudPair(ctx, LOGICAL_W - 24, HUD_Y, '得分', String(state.score), 'right', THEME.gold)

  for (let c = 0; c < GRID * GRID; c += 1) {
    drawCellBase(ctx, cellRect(c))
  }

  if (state.phase === 'showing' && opts.settleCells === null) {
    drawShowing(ctx, state)
  } else if (state.phase === 'input') {
    drawInput(ctx, state, opts.wrongCell)
  } else if (state.phase === 'over') {
    // 结束时静止展示最后一条路径的淡影。
    for (let i = 0; i < state.path.length; i += 1) {
      drawCellGlow(ctx, cellRect(state.path[i]!), THEME.bad, 0.15)
    }
    if (opts.wrongCell !== null && opts.wrongCell >= 0) {
      drawCellGlow(ctx, cellRect(opts.wrongCell), THEME.bad, 0.5)
    }
  }
  if (opts.settleCells !== null) {
    // 庆祝的是刚走完的旧路径（state.path 已是新一轮路径，不可外泄）。
    for (const cell of opts.settleCells) {
      drawCellGlow(ctx, cellRect(cell), THEME.good, 0.4)
    }
  }

  // 底部提示：动态段（阶段/重看余量）整体居中，唯一可变字符宽度有限，
  // 居中区 24..420 与右侧说明按钮（436 起）不相交。
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = THEME.textMuted
  let hint: string
  if (state.phase === 'input') {
    hint = '从「起」开始按序点击 · 空格重看(' + (state.replayUsed ? '0' : '1') + ')'
  } else if (state.phase === 'over') {
    hint = '按 R 重开'
  } else {
    hint = '记住闪现的路径 · R 重开 · P 暂停 · H 说明'
  }
  ctx.fillText(hint, 222, HINT_Y)

  particles?.tick(ctx, dtMs)

  if (state.phase === 'over') {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '游戏结束',
      '得分 ' + state.score + ' · 到第 ' + state.round + ' 轮 · 按 R 重开', THEME.bad)
  } else if (opts.paused) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '已暂停', '按 P 继续', THEME.text)
  }

  drawHelpButton(ctx, opts.helpOpen)
  if (opts.helpOpen) drawHelpPanel(ctx)
}

/** 说明按钮（渲染末尾、最上层）。 */
function drawHelpButton(ctx: CanvasRenderingContext2D, open: boolean): void {
  roundRectPath(ctx, HELP_BUTTON.x, HELP_BUTTON.y, HELP_BUTTON.w, HELP_BUTTON.h, 6)
  ctx.fillStyle = open ? accent(0) : THEME.panel
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = open ? '#15151b' : THEME.text
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(open ? '关闭' : '说明', HELP_BUTTON.x + HELP_BUTTON.w / 2, HELP_BUTTON.y + 16)
}

/** 帮助面板文案（15px 大字，8 行完整规则 + 易误解点）。 */
const HELP_LINES = [
  '每轮一条路径逐格闪现：从标「起」的格子开始。',
  '闪完后按相同顺序点击每个格子，复现整条路径。',
  '全对进入下一轮：路径 +1 步，闪现也逐轮加快。',
  '第 3 轮起有传送格（标 ◆）：它与上一格不相邻。',
  '传送格也是路径的一步，闪现后照样按顺序点到。',
  '第 5 轮起有干扰微闪：又短又暗的不是路径格。',
  '点错一步扣 1 命（共 3 命），并重看本条路径。',
  '输入阶段可按空格重看一次，每轮限一次机会。',
]

/** 帮助面板（渲染最末尾、盖在一切之上，任何阶段可开合）。 */
function drawHelpPanel(ctx: CanvasRenderingContext2D): void {
  const w = 460
  const h = 340
  const x = (LOGICAL_W - w) / 2
  const y = (LOGICAL_H - h) / 2
  roundRectPath(ctx, x, y, w, h, 10)
  ctx.fillStyle = 'rgba(20,20,30,0.96)'
  ctx.fill()
  ctx.strokeStyle = accent(0)
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.font = 'bold 18px system-ui, sans-serif'
  ctx.fillStyle = THEME.text
  ctx.fillText('记忆路径 规则说明', LOGICAL_W / 2, y + 40)
  ctx.font = '500 15px system-ui, sans-serif'
  ctx.textAlign = 'left'
  for (let i = 0; i < HELP_LINES.length; i += 1) {
    ctx.fillText(HELP_LINES[i]!, x + 28, y + 84 + i * 26)
  }
  ctx.textAlign = 'center'
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('点右下角「说明」或按 H 关闭 · 暂停时也能看', LOGICAL_W / 2, y + h - 18)
}
