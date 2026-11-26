/**
 * 骨牌对对渲染层：一排象牙色数字骨牌（上半点数阵 / 下半大数字，中
 * 缝分线），锁定骨牌罩灰并画小挂锁，选中金框发光，已就位绿边，提示
 * 对金色虚线框 + 双向箭头；HUD 显示分数 / 关卡 / 剩余交换 / 步数预
 * 算，下方步数预算进度条；交换与过关迸发粒子；暂停与结算遮罩；渲染
 * 函数末尾最上层画「说明」按钮与 15px 大字帮助面板（任何阶段可开
 * 合，展开时遮住场面）。拖拽中的骨牌以半透明幽灵跟随指针。
 */
import type { DominoShuffleState } from './logic.ts'
import { W, H, BOARD_Y, TILE_H, LEVEL_COUNT, HELP_BTN, tileRect } from './logic.ts'
import { THEME, accent, createParticles, drawBackground, drawOverlay, glow, hudPair, noGlow, roundRectPath } from '../theme.ts'

const BONE = '#ece5d4'
const BONE_EDGE = '#b9b09a'
const BONE_LOCKED = '#b6b1a3'
const INK = '#2b2b33'
const LOCK_INK = '#5a5a72'
const HUD_BAND = 'rgba(13,13,20,0.42)'
const BAR_BG = 'rgba(52,52,74,0.55)'

/** 帮助面板正文行（15px 大字，8 行完整规则）。 */
const HELP_LINES: readonly string[] = [
  '一排数字骨牌被随机打乱，点击相邻的两张交换位置，',
  '把整排排成左小右大的升序（可拖拽一张到相邻格）。',
  '只能交换相邻两张；带锁的骨牌不能交换——锁着的骨牌',
  '一定已在正确位置，可以当作排序的锚点。',
  '步数预算 = 最少交换次数（逆序对数）+ 少量缓冲，',
  '第 5 关没有缓冲，每一步都必须消除一个逆序。',
  'H 提示（每关 3 次，高亮一对该换的骨牌）· R 重开本关。',
  'P 暂停 · 剩余步数与未用提示都计入过关加分。',
]

/** 点数阵：1-9 的标准骰面布局（列、行 0-2）。 */
const PIPS: readonly (readonly (readonly [number, number])[])[] = [
  [],
  [[1, 1]],
  [[0, 0], [2, 2]],
  [[0, 0], [1, 1], [2, 2]],
  [[0, 0], [0, 2], [2, 0], [2, 2]],
  [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
  [[0, 0], [0, 1], [0, 2], [2, 0], [2, 1], [2, 2]],
  [[0, 0], [0, 1], [0, 2], [1, 1], [2, 0], [2, 1], [2, 2]],
  [[0, 0], [0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1], [2, 2]],
  [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]],
]

/** 渲染层自有的粒子系统（每个画布一个实例）。 */
const particles = createParticles()

/**
 * 是否有存活粒子（脏渲染模式下决定是否需要按帧重绘）。
 * @returns 有粒子返回 true。
 */
export function dominoParticlesActive(): boolean {
  return particles.size() > 0
}

/**
 * 画一颗小挂锁（锁定骨牌的角标）。
 * @param ctx - 画布上下文。
 * @param x - 锁体左上角 x。
 * @param y - 锁体上沿 y。
 */
function drawPadlock(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.strokeStyle = LOCK_INK
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.arc(x + 4.5, y + 3, 3, Math.PI, 0)
  ctx.stroke()
  ctx.fillStyle = LOCK_INK
  ctx.fillRect(x, y + 3, 9, 7)
}

/**
 * 画一张骨牌：骨面 / 锁定罩灰、中缝、上半点数阵（≥10 用小数字）、
 * 下半大数字、选中金框、就位绿边、提示虚线框、锁定挂锁。
 * @param ctx - 画布上下文。
 * @param x - 左上角 x。
 * @param y - 左上角 y。
 * @param w - 宽。
 * @param h - 高。
 * @param value - 骨牌数值。
 * @param locked - 是否锁定。
 * @param selected - 是否选中。
 * @param inPlace - 是否已在正确位置。
 * @param hinted - 是否提示高亮。
 */
function drawDomino(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  value: number,
  locked: boolean,
  selected: boolean,
  inPlace: boolean,
  hinted: boolean,
): void {
  if (selected) glow(ctx, THEME.gold, 12)
  ctx.fillStyle = locked ? BONE_LOCKED : BONE
  roundRectPath(ctx, x, y, w, h, 7)
  ctx.fill()
  noGlow(ctx)
  ctx.strokeStyle = BONE_EDGE
  ctx.lineWidth = 1.5
  ctx.stroke()
  // 中缝分线。
  ctx.strokeStyle = 'rgba(43,43,51,0.35)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x + 5, y + h / 2)
  ctx.lineTo(x + w - 5, y + h / 2)
  ctx.stroke()
  // 上半：点数阵（≥10 画小数字）。center = (x + w/2, y + h/4)。
  const topCx = x + w / 2
  const topCy = y + h / 4
  if (value <= 9) {
    const gridW = Math.min(w - 12, 30)
    const cell = gridW / 2
    ctx.fillStyle = INK
    for (const [col, row] of PIPS[value]!) {
      ctx.beginPath()
      ctx.arc(topCx + (col - 1) * cell, topCy + (row - 1) * cell, Math.max(1.8, cell * 0.28), 0, Math.PI * 2)
      ctx.fill()
    }
  } else {
    ctx.font = 'bold 13px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = INK
    ctx.fillText(String(value), topCx, topCy)
  }
  // 下半：大数字（排序主信息）。
  ctx.font = 'bold ' + (w >= 44 ? 22 : 18) + 'px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = INK
  ctx.fillText(String(value), x + w / 2, y + h * 0.75)
  ctx.textBaseline = 'alphabetic'
  // 状态描边：就位绿边 > 选中金框 > 提示虚线框。
  if (inPlace) {
    ctx.strokeStyle = THEME.good
    ctx.lineWidth = 2
    roundRectPath(ctx, x + 1, y + 1, w - 2, h - 2, 6)
    ctx.stroke()
  }
  if (selected) {
    ctx.strokeStyle = THEME.gold
    ctx.lineWidth = 2.5
    roundRectPath(ctx, x + 1.5, y + 1.5, w - 3, h - 3, 6)
    ctx.stroke()
  } else if (hinted) {
    ctx.strokeStyle = THEME.gold
    ctx.lineWidth = 2
    ctx.setLineDash([5, 4])
    roundRectPath(ctx, x + 1, y + 1, w - 2, h - 2, 6)
    ctx.stroke()
    ctx.setLineDash([])
  }
  if (locked) {
    ctx.fillStyle = 'rgba(30,30,42,0.18)'
    roundRectPath(ctx, x, y, w, h, 7)
    ctx.fill()
    drawPadlock(ctx, x + w - 12, y + 4)
  }
}

/**
 * 画提示对之间的双向箭头（骨牌行下方）。
 * @param ctx - 画布上下文。
 * @param i - 左槽位。
 * @param j - 右槽位。
 * @param n - 骨牌张数。
 */
function drawHintArrow(ctx: CanvasRenderingContext2D, i: number, j: number, n: number): void {
  const ri = tileRect(i, n)
  const rj = tileRect(j, n)
  const cx = (ri.x + ri.w / 2 + rj.x + rj.w / 2) / 2
  const y = BOARD_Y + TILE_H + 16
  ctx.strokeStyle = THEME.gold
  ctx.lineWidth = 2
  ctx.setLineDash([4, 3])
  ctx.beginPath()
  ctx.moveTo(ri.x + ri.w / 2, y - 4)
  ctx.lineTo(rj.x + rj.w / 2, y - 4)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(cx - 6, y + 2)
  ctx.lineTo(cx, y + 8)
  ctx.lineTo(cx + 6, y + 2)
  ctx.stroke()
}

/**
 * 画 HUD 顶栏：左分数、中关卡与剩余交换、右步数（右锚定）。
 * @param ctx - 画布上下文。
 * @param state - 当前状态。
 */
function drawHud(ctx: CanvasRenderingContext2D, state: DominoShuffleState): void {
  ctx.fillStyle = HUD_BAND
  roundRectPath(ctx, 4, 4, W - 8, 24, 8)
  ctx.fill()
  const hudY = 20
  hudPair(ctx, 14, hudY, '分数', String(state.score))
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = THEME.text
  ctx.fillText('第 ' + state.level + '/' + LEVEL_COUNT + ' 关 · 剩余交换 ' + state.inversions, W / 2, hudY)
  const steps = state.moves + '/' + state.budget
  hudPair(ctx, W - 14, hudY, '步数', steps, 'right', state.moves >= state.budget ? THEME.bad : THEME.text)
}

/**
 * 画状态行：锁定提示（红）、提示对（金）或默认操作说明。
 * @param ctx - 画布上下文。
 * @param state - 当前状态。
 */
function drawStatus(ctx: CanvasRenderingContext2D, state: DominoShuffleState): void {
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'left'
  const lockedEv = state.events.find((e) => e.type === 'lockedClick')
  if (lockedEv !== undefined) {
    ctx.fillStyle = THEME.bad
    ctx.fillText('锁定骨牌不能交换，换相邻未锁的试试', 24, 150)
    return
  }
  if (state.hintPair !== null) {
    ctx.fillStyle = THEME.gold
    ctx.fillText('提示：交换第 ' + (state.hintPair[0] + 1) + ' 与 ' + (state.hintPair[1] + 1) + ' 张', 24, 150)
    return
  }
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('点击相邻两张骨牌交换 · 剩余提示 ' + state.hintsLeft, 24, 150)
}

/**
 * 画步数预算进度条（右锚定数字，随占用变色）。
 * @param ctx - 画布上下文。
 * @param state - 当前状态。
 */
function drawBudgetBar(ctx: CanvasRenderingContext2D, state: DominoShuffleState): void {
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('步数预算', 24, 328)
  ctx.textAlign = 'right'
  ctx.fillStyle = state.moves >= state.budget ? THEME.bad : THEME.text
  ctx.fillText(state.moves + ' / ' + state.budget, W - 24, 328)
  ctx.fillStyle = BAR_BG
  roundRectPath(ctx, 24, 334, W - 48, 10, 5)
  ctx.fill()
  const ratio = state.budget <= 0 ? 0 : Math.min(1, state.moves / state.budget)
  if (ratio > 0) {
    ctx.fillStyle = state.moves >= state.budget ? THEME.bad : THEME.gold
    roundRectPath(ctx, 24, 334, (W - 48) * ratio, 10, 5)
    ctx.fill()
  }
}

/**
 * 画「说明」按钮（60×24，始终可见、任何阶段可点开合）。
 * @param ctx - 画布上下文。
 * @param helpOpen - 帮助面板是否展开。
 */
function drawHelpButton(ctx: CanvasRenderingContext2D, helpOpen: boolean): void {
  ctx.fillStyle = THEME.panel
  roundRectPath(ctx, HELP_BTN.x, HELP_BTN.y, HELP_BTN.w, HELP_BTN.h, 6)
  ctx.fill()
  ctx.strokeStyle = helpOpen ? THEME.gold : THEME.panelEdge
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = helpOpen ? THEME.gold : THEME.text
  ctx.fillText(helpOpen ? '关闭' : '说明', HELP_BTN.x + HELP_BTN.w / 2, HELP_BTN.y + 16)
}

/**
 * 画帮助面板：480×350 居中面板、16px 标题、15px 正文 8 行完整规则。
 * @param ctx - 画布上下文。
 */
function drawHelpPanel(ctx: CanvasRenderingContext2D): void {
  const px = (W - 480) / 2
  const py = 110
  const pw = 480
  const ph = 350
  ctx.fillStyle = THEME.panel
  roundRectPath(ctx, px, py, pw, ph, 12)
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.font = 'bold 16px system-ui, sans-serif'
  ctx.fillStyle = THEME.text
  ctx.fillText('骨牌对对 · 玩法', W / 2, py + 34)
  ctx.strokeStyle = 'rgba(52,52,74,0.9)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(px + 24, py + 46)
  ctx.lineTo(px + pw - 24, py + 46)
  ctx.stroke()
  ctx.font = '15px system-ui, sans-serif'
  ctx.fillStyle = THEME.text
  for (let i = 0; i < HELP_LINES.length; i += 1) {
    ctx.fillText(HELP_LINES[i]!, W / 2, py + 78 + i * 32)
  }
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('再点「关闭」或任意空白处收起', W / 2, py + ph - 16)
}

/**
 * 消费逻辑层事件并迸发粒子：交换本色、过关金、通关绿、失败红、
 * 点锁定灰。
 * @param ctx - 画布上下文。
 * @param state - 当前状态。
 */
function burstEvents(ctx: CanvasRenderingContext2D, state: DominoShuffleState): void {
  for (const ev of state.events) {
    if (ev.type === 'swap') particles.burst(ev.x, ev.y, accent(state.tiles[ev.j]! - 1), 10, 140)
    else if (ev.type === 'level') particles.burst(ev.x, ev.y, THEME.gold, 26, 190)
    else if (ev.type === 'win') particles.burst(ev.x, ev.y, THEME.good, 40, 220)
    else if (ev.type === 'fail') particles.burst(ev.x, ev.y, THEME.bad, 24, 180)
    else if (ev.type === 'lockedClick') particles.burst(ev.x, ev.y, '#7a7a90', 5, 80)
  }
}

/**
 * 渲染一帧：背景、状态行、骨牌行（含提示箭头与拖拽幽灵）、步数预
 * 算条、粒子、HUD、遮罩，最后最上层画说明按钮与帮助面板。
 * @param ctx - 画布上下文。
 * @param state - 当前状态。
 * @param paused - 是否显示暂停遮罩。
 * @param helpOpen - 帮助面板是否展开。
 * @param drag - 拖拽中骨牌的槽位与指针逻辑坐标（非拖拽为 null）。
 * @param dtMs - 粒子推进时长 ms。
 */
export function renderDominoShuffle(
  ctx: CanvasRenderingContext2D,
  state: DominoShuffleState,
  paused: boolean,
  helpOpen: boolean,
  drag: { index: number, x: number, y: number } | null,
  dtMs: number,
): void {
  drawBackground(ctx, W, H)
  drawStatus(ctx, state)
  const n = state.tiles.length
  for (let i = 0; i < n; i += 1) {
    const r = tileRect(i, n)
    if (drag !== null && drag.index === i) {
      // 拖拽中的原位骨牌降为半透明，幽灵跟随指针。
      ctx.globalAlpha = 0.35
    }
    drawDomino(
      ctx, r.x, r.y, r.w, r.h, state.tiles[i]!, state.locked[i]!,
      state.selected === i, state.tiles[i] === i + 1,
      state.hintPair !== null && (state.hintPair[0] === i || state.hintPair[1] === i),
    )
    ctx.globalAlpha = 1
  }
  if (state.hintPair !== null) drawHintArrow(ctx, state.hintPair[0], state.hintPair[1], n)
  if (drag !== null) {
    const r = tileRect(drag.index, n)
    ctx.globalAlpha = 0.55
    drawDomino(ctx, drag.x - r.w / 2, drag.y - r.h / 2, r.w, r.h, state.tiles[drag.index]!, state.locked[drag.index]!, false, false, false)
    ctx.globalAlpha = 1
  }
  drawBudgetBar(ctx, state)
  burstEvents(ctx, state)
  particles.tick(ctx, paused ? 0 : dtMs)
  drawHud(ctx, state)
  if (paused) {
    drawOverlay(ctx, W, H, '暂停', '按 P 继续 · R 重开本关')
  } else if (state.over) {
    if (state.win) {
      drawOverlay(ctx, W, H, '全部完成', '五关排毕 · 总分 ' + state.score + ' · 按 R 重开', THEME.good)
    } else {
      drawOverlay(ctx, W, H, '步数用尽', '第 ' + state.level + ' 关失败 · 按 R 重试本关', THEME.bad)
    }
  }
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('H 提示 · R 重开本关 · P 暂停', W / 2, 460)
  // 最上层：说明按钮 + 帮助面板（渲染函数末尾，任何阶段可开合）。
  drawHelpButton(ctx, helpOpen)
  if (helpOpen) drawHelpPanel(ctx)
}
