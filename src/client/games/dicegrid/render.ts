/**
 * 骰子彩窗 DiceGrid 渲染：教堂彩窗风格（深色格 + 铅条描边），含约束角标、
 * 点数骰面绘制、候选骰架、冲突红显、弃骰按钮、HUD、说明按钮与帮助面板。
 * 纯 canvas 绘制，无 DOM 依赖；命中测试返回逻辑坐标。
 */
import { accent, drawBackground, drawOverlay, glow, hudPair, noGlow, roundRectPath, THEME } from '../theme.ts'
import { canPlaceDie, CELLS, GRID, LEVEL_COUNT, type Die, type DiceGameState } from './logic.ts'

/** 逻辑画布宽。 */
export const LOGICAL_W = 480
/** 逻辑画布高。 */
export const LOGICAL_H = 560

// ===== 布局常量（两两不相交核算见各注释） =====
/** 顶部 HUD 条（0,0,480,36）。 */
const HUD_H = 36
/** 彩窗格边长与间隙：4×74 + 3×6 = 314，起点 x=83（水平居中）、y=56。 */
const CELL = 74
const GAP = 6
const GRID_X = 83
const GRID_Y = 56
/** 候选骰边长 56、间距 12：4×56+3×12 = 260，x=110 居中；y=414。 */
const RACK_DIE = 56
const RACK_GAP = 12
const RACK_Y = 414
/** 弃骰按钮（110,496,84,28)。 */
const DISCARD_BTN = { x: 110, y: 496, w: 84, h: 28 }
/** 说明按钮（406,496,60,24)，60x24。 */
const HELP_BTN = { x: 406, y: 496, w: 60, h: 24 }

/** 渲染层视图状态（index 维护）。 */
export interface DiceGridView {
  selected: number | null
  paused: boolean
  helpOpen: boolean
  /** 短暂提示文案（下一次交互清除）。 */
  flash: string
}

/** 帮助面板文案（15px 大字，8 行完整规则 + 易误解点）。 */
const HELP_LINES = [
  '从下方候选骰架挑一颗骰，再点彩窗空格放置',
  '点数约束：同一行、同一列不许出现相同点数',
  '颜色约束：上下左右相邻格不许是相同颜色',
  '角标是硬约束：色点=限色，数字=限点，奇/偶/≥4=限点数属性',
  '放不进时先选骰再点「弃骰」丢弃（每颗扣 3 分）',
  '16 格全部填满即过关，共 5 关，颜色与约束逐关增多',
  '快捷键：R 重开本关 · P 暂停/继续',
  '易误解：点数看整行整列，颜色只看紧邻的四格',
]

/** 骰子颜色 → 主题色（与 THEME.accents 前 4 档一致，随色种数取前 N）。 */
const dieColor = (color: number): string => accent(color)

/** 画一颗骰面：圆角方块 + 标准点阵。 */
function drawDie(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, die: Die): void {
  const color = dieColor(die.color)
  roundRectPath(ctx, x + 2, y + 2, size - 4, size - 4, 8)
  ctx.fillStyle = color
  glow(ctx, color, 7)
  ctx.globalAlpha = 0.9
  ctx.fill()
  ctx.globalAlpha = 1
  noGlow(ctx)
  ctx.strokeStyle = 'rgba(13,13,20,0.55)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.fillStyle = '#14141c'
  const p = size / 8
  const cx = x + size / 2
  const cy = y + size / 2
  const positions: Record<number, [number, number][]> = {
    1: [[0, 0]],
    2: [[-1.6, -1.6], [1.6, 1.6]],
    3: [[-1.6, -1.6], [0, 0], [1.6, 1.6]],
    4: [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]],
    5: [[-1.6, -1.6], [1.6, -1.6], [0, 0], [-1.6, 1.6], [1.6, 1.6]],
    6: [[-1.6, -1.6], [1.6, -1.6], [-1.6, 0], [1.6, 0], [-1.6, 1.6], [1.6, 1.6]],
  }
  for (const [dx, dy] of positions[die.value]!) {
    ctx.beginPath()
    ctx.arc(cx + dx * p, cy + dy * p, size / 12, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** 约束角标文字：数字/奇/偶/≥4（色点另画）。 */
function constraintText(constraint: { kind: string; value?: number }): string {
  switch (constraint.kind) {
    case 'value':
      return String(constraint.value)
    case 'odd':
      return '奇'
    case 'even':
      return '偶'
    case 'gt3':
      return '≥4'
    default:
      return ''
  }
}

/** 画一个彩窗格：深色玻璃 + 铅条边 + 约束角标 / 骰面 / 红显。 */
function drawCell(ctx: CanvasRenderingContext2D, state: DiceGameState, view: DiceGridView, r: number, c: number): void {
  const x = GRID_X + c * (CELL + GAP)
  const y = GRID_Y + r * (CELL + GAP)
  const cell = state.board[r]![c]!
  roundRectPath(ctx, x, y, CELL, CELL, 8)
  ctx.fillStyle = cell.die === null ? 'rgba(30,30,46,0.92)' : 'rgba(24,24,36,0.6)'
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1.5
  ctx.stroke()
  if (cell.constraint !== null) {
    if (cell.constraint.kind === 'color') {
      ctx.beginPath()
      ctx.fillStyle = dieColor(cell.constraint.color)
      ctx.arc(x + 12, y + 12, 6, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.beginPath()
      ctx.fillStyle = dieColor(0)
      ctx.arc(x + 12, y + 12, 4.5, 0, Math.PI * 2)
      ctx.fill()
    }
    const text = constraintText(cell.constraint)
    if (text !== '') {
      ctx.font = 'bold 13px system-ui, sans-serif'
      ctx.textAlign = 'right'
      ctx.fillStyle = THEME.textMuted
      ctx.fillText(text, x + CELL - 6, y + 17)
    }
  }
  if (cell.die !== null) {
    drawDie(ctx, x + 9, y + 9, CELL - 18, cell.die)
    return
  }
  // 冲突红显：选中骰后，非法空格整体铺一层暗红提示。
  if (view.selected !== null && state.rack[view.selected] !== undefined
    && !canPlaceDie(state, r, c, state.rack[view.selected]!)) {
    roundRectPath(ctx, x, y, CELL, CELL, 8)
    ctx.fillStyle = 'rgba(247,118,142,0.14)'
    ctx.fill()
  }
}

/**
 * 命中测试：逻辑坐标 → 彩窗格（行、列），未命中返回 null。
 * @param x - 逻辑 x。
 * @param y - 逻辑 y。
 */
export function gridCellAt(x: number, y: number): { r: number; c: number } | null {
  if (x < GRID_X || y < GRID_Y) return null
  const gx = Math.floor((x - GRID_X) / (CELL + GAP))
  const gy = Math.floor((y - GRID_Y) / (CELL + GAP))
  if (gx < 0 || gx >= GRID || gy < 0 || gy >= GRID) return null
  if (x > GRID_X + gx * (CELL + GAP) + CELL || y > GRID_Y + gy * (CELL + GAP) + CELL) return null
  return { r: gy, c: gx }
}

/**
 * 命中测试：逻辑坐标 → 候选骰架索引，未命中返回 null。
 * @param x - 逻辑 x。
 * @param y - 逻辑 y。
 * @param count - 当前骰架上的骰子数。
 */
export function rackDieAt(x: number, y: number, count: number): number | null {
  const total = count * RACK_DIE + (count - 1) * RACK_GAP
  const x0 = (LOGICAL_W - total) / 2
  for (let i = 0; i < count; i += 1) {
    const dx = x0 + i * (RACK_DIE + RACK_GAP)
    if (x >= dx && x <= dx + RACK_DIE && y >= RACK_Y && y <= RACK_Y + RACK_DIE) return i
  }
  return null
}

/** 逻辑坐标是否点中弃骰按钮。 */
export function inDiscardBtn(x: number, y: number): boolean {
  return x >= DISCARD_BTN.x && x <= DISCARD_BTN.x + DISCARD_BTN.w
    && y >= DISCARD_BTN.y && y <= DISCARD_BTN.y + DISCARD_BTN.h
}

/** 逻辑坐标是否点中说明按钮。 */
export function inHelpBtn(x: number, y: number): boolean {
  return x >= HELP_BTN.x && x <= HELP_BTN.x + HELP_BTN.w
    && y >= HELP_BTN.y && y <= HELP_BTN.y + HELP_BTN.h
}

/**
 * 全量重绘：背景 → HUD → 彩窗 → 骰架 → 弃骰按钮 → 提示 → 过关/暂停
 * overlay → 帮助面板 + 说明按钮（渲染函数末尾，永远最上层）。
 * @param ctx - 画布上下文。
 * @param state - 逻辑状态。
 * @param view - 视图状态。
 */
export function renderDiceGrid(ctx: CanvasRenderingContext2D, state: DiceGameState, view: DiceGridView): void {
  drawBackground(ctx, LOGICAL_W, LOGICAL_H)

  // HUD（条 0..36，与网格 y=56 起不相交）。
  ctx.fillStyle = THEME.panel
  ctx.fillRect(0, 0, LOGICAL_W, HUD_H)
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, LOGICAL_W - 1, HUD_H - 1)
  const remaining = CELLS - state.placed
  hudPair(ctx, 10, 22, '关卡 ', state.level + '/' + LEVEL_COUNT, 'left', accent(2))
  hudPair(ctx, 150, 22, '剩余 ', String(remaining), 'left')
  hudPair(ctx, LOGICAL_W - 10, 22, '弃骰 ', String(state.discarded), 'right',
    state.discarded === 0 ? THEME.text : THEME.bad)

  // 彩窗标题行（y=48 基线，位于 HUD 下方、网格上方的空带）。
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('彩 窗', LOGICAL_W / 2, 48)

  for (let r = 0; r < GRID; r += 1) {
    for (let c = 0; c < GRID; c += 1) drawCell(ctx, state, view, r, c)
  }

  // 候选骰架（y=414..470，网格底 y=370，间隔 44px）。
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('候选', 76, RACK_Y - 10)
  const count = state.rack.length
  const total = count * RACK_DIE + (count - 1) * RACK_GAP
  const x0 = (LOGICAL_W - total) / 2
  for (let i = 0; i < count; i += 1) {
    const dx = x0 + i * (RACK_DIE + RACK_GAP)
    drawDie(ctx, dx, RACK_Y, RACK_DIE, state.rack[i]!)
    if (view.selected === i) {
      roundRectPath(ctx, dx - 1, RACK_Y - 1, RACK_DIE + 2, RACK_DIE + 2, 9)
      ctx.strokeStyle = THEME.gold
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.lineWidth = 1
    }
  }

  // 弃骰按钮（y=496..524，骰架底 470，间隔 26px）。
  roundRectPath(ctx, DISCARD_BTN.x, DISCARD_BTN.y, DISCARD_BTN.w, DISCARD_BTN.h, 7)
  ctx.fillStyle = view.selected === null ? 'rgba(30,30,46,0.7)' : THEME.panel
  ctx.fill()
  ctx.strokeStyle = view.selected === null ? THEME.panelEdge : THEME.bad
  ctx.lineWidth = view.selected === null ? 1 : 1.5
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = view.selected === null ? THEME.textMuted : THEME.bad
  ctx.fillText('弃骰', DISCARD_BTN.x + DISCARD_BTN.w / 2, DISCARD_BTN.y + 19)

  // 提示文案（骰架与底行之间的空带 y=488 基线）。
  if (view.flash !== '') {
    ctx.font = '600 13px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = THEME.gold
    ctx.fillText(view.flash, LOGICAL_W / 2, 489)
  }

  if (state.won) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '过关！',
      '弃骰 ' + state.discarded + ' 颗 · 得分 ' + Math.max(0, 60 + state.level * 15 - state.discarded * 3)
      + ' · 点击进入下一关', THEME.good)
  } else if (view.paused) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '已暂停', '按 P 继续', THEME.text)
  }

  // 说明面板（半透明模态，覆盖棋盘——最上层）。
  if (view.helpOpen) {
    const hp = { x: 56, y: 130, w: LOGICAL_W - 112, h: HELP_LINES.length * 25 + 26 }
    roundRectPath(ctx, hp.x, hp.y, hp.w, hp.h, 10)
    ctx.fillStyle = 'rgba(13,13,20,0.93)'
    ctx.fill()
    ctx.strokeStyle = THEME.panelEdge
    ctx.stroke()
    ctx.textAlign = 'left'
    ctx.font = '600 15px system-ui, sans-serif'
    HELP_LINES.forEach((line, i) => {
      ctx.fillStyle = i === 0 ? accent(2) : THEME.text
      ctx.fillText(line, hp.x + 16, hp.y + 26 + i * 25)
    })
  }
  // 说明按钮（渲染函数最后一笔，任何阶段可见、不被棋盘遮挡）。
  roundRectPath(ctx, HELP_BTN.x, HELP_BTN.y, HELP_BTN.w, HELP_BTN.h, 7)
  ctx.fillStyle = THEME.panel
  ctx.fill()
  ctx.strokeStyle = view.helpOpen ? accent(2) : THEME.panelEdge
  ctx.lineWidth = view.helpOpen ? 2 : 1
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.textAlign = 'center'
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.fillStyle = view.helpOpen ? accent(2) : THEME.textMuted
  ctx.fillText('说明', HELP_BTN.x + HELP_BTN.w / 2, HELP_BTN.y + 17)
}
