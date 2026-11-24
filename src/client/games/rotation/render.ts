/**
 * 转盘密码 canvas 渲染：黄铜密码盘风格——同心环上铜块挡板与暗孔空缺、
 * 选中层高亮、层号标注、径向光束逐层绿通/红断、旋转补间动画、目标角
 * 三角标记与度数、关卡/步数/目标 HUD、说明按钮与大字帮助面板（渲染函
 * 数末尾最上层）、暂停/过关 overlay 与过关光束射出特效。使用共享视觉
 * 套件（../theme.ts）。文件内不使用模板字符串。
 */
import type { RotationState } from './logic.ts'
import { LEVEL_COUNT, beamAt } from './logic.ts'
import {
  THEME, accent, createParticles, drawBackground, drawOverlay, glow, hudPair, noGlow,
  roundRectPath,
} from '../theme.ts'

/** 固定逻辑画布尺寸。 */
export const LOGICAL_W = 480
export const LOGICAL_H = 540
/** 顶部 HUD 高度。 */
export const HUD_H = 44
/** 盘面圆心与半径。 */
export const CX = 240
export const CY = 262
export const BOARD_R = 186
/** 最内层环带内缘半径（中心光珠区外沿）。 */
export const RING_START = 26
/** 中心光珠半径。 */
export const PEARL_R = 13
/** 说明按钮矩形（点击开合帮助面板，任何阶段可用）。 */
export const HELP_RECT = { x: 404, y: 494, w: 60, h: 24 }

const TAU = Math.PI * 2
/** 黄铜盘面色。 */
const BRASS_BASE = '#15141f'
const BRASS_PLATE = '#6e5a30'
const BRASS_EDGE = '#241f12'

/** 帮助面板文案（15px 大字，规则 + 易误解点）。 */
const HELP_TITLE = '转盘密码 · 玩法说明'
const HELP_LINES: readonly string[] = [
  '1. 点击圆环或按 1-6 选层，←/→ 旋转一格。',
  '2. 中心光珠要沿半径穿出：该角度上每一层',
  '   都必须是空缺（暗孔），挡板（铜块）会拦光。',
  '3. 光束逐层绿=通、红=断，全绿即射出盘面。',
  '4. 每关依次打通金色三角标记的多个目标角。',
  '5. 步数越少奖励越高；R 重开本关不扣分。',
  '易误解：只有当前金色目标角推进进度，',
  '   已打通的角度再被挡住不影响过关。',
]

/** 渲染侧视图选项。 */
export interface RotationView {
  paused: boolean
}

// 模块级渲染状态（同一时刻只挂载一个实例）。
const particles = createParticles()
let helpOpen = false
let prevWon = false
let prevLevel = -1
let prevFrameMs = 0
/** 每层旋转补间：cur 当前显示角（度），goal 目标角，lastRot 逻辑步数。 */
interface RingAnim { cur: number, goal: number, lastRot: number }
const anims = new Map<number, RingAnim>()

/** 非负模（度）。 */
function mod360(n: number): number {
  return ((n % 360) + 360) % 360
}

/** 第 i 层（共 n 层）的内/外半径。 */
function ringRadii(n: number, i: number): { rIn: number, rOut: number } {
  const t = (BOARD_R - RING_START) / n
  return { rIn: RING_START + i * t + 1.5, rOut: RING_START + (i + 1) * t - 1.5 }
}

/** 点击命中层下标：落在环带内返回 0..n-1，否则 null。 */
export function ringIndexAt(x: number, y: number, layerCount: number): number | null {
  const r = Math.hypot(x - CX, y - CY)
  if (r < RING_START || r > BOARD_R) return null
  const i = Math.floor((r - RING_START) / ((BOARD_R - RING_START) / layerCount))
  return Math.min(layerCount - 1, Math.max(0, i))
}

/** 点击是否命中说明按钮。 */
export function helpButtonAt(x: number, y: number): boolean {
  return x >= HELP_RECT.x && x < HELP_RECT.x + HELP_RECT.w
    && y >= HELP_RECT.y && y < HELP_RECT.y + HELP_RECT.h
}

/** 开/关帮助面板（任何阶段可开合）。 */
export function toggleHelp(): void {
  helpOpen = !helpOpen
}

/** 关闭帮助面板（Escape）。 */
export function closeHelp(): void {
  helpOpen = false
}

/** 旋转补间是否仍在进行（进行中时调用方应持续重绘）。 */
export function isAnimating(): boolean {
  for (const a of anims.values()) if (Math.abs(a.goal - a.cur) > 0.2) return true
  return false
}

/** 推进每层旋转补间：目标角沿最短弧接近，关卡切换时重置。 */
function updateAnim(state: RotationState, dtMs: number): void {
  if (state.level !== prevLevel) {
    anims.clear()
    prevLevel = state.level
  }
  const dt = dtMs / 1000
  state.board.layers.forEach((layer, i) => {
    let a = anims.get(i)
    if (a === undefined) {
      const init = (layer.rotation * 360) / layer.slots
      a = { cur: init, goal: init, lastRot: layer.rotation }
      anims.set(i, a)
      return
    }
    if (layer.rotation !== a.lastRot) {
      a.lastRot = layer.rotation
      const target = (layer.rotation * 360) / layer.slots
      let delta = mod360(target - a.cur)
      if (delta > 180) delta -= 360
      a.goal = a.cur + delta
    }
    a.cur += (a.goal - a.cur) * Math.min(1, dt * 14)
    if (Math.abs(a.goal - a.cur) < 0.15) a.cur = a.goal
  })
}

/** 当前待打通的目标角（已全通时取最后一个）。 */
function currentTargetAngle(state: RotationState): number {
  const angles = state.board.targetAngles
  return angles[Math.min(state.targetIndex, angles.length - 1)]!
}

/** 画一层：环带底、挡板铜块、内缘高光、选中高亮与层号。 */
function drawRing(ctx: CanvasRenderingContext2D, state: RotationState, i: number, disp: number): void {
  const layer = state.board.layers[i]!
  const n = state.board.layers.length
  const { rIn, rOut } = ringRadii(n, i)
  const selected = i === state.selectedLayer && state.status === 'playing'
  // 环带底：空缺处透出的暗孔底色。
  ctx.beginPath()
  ctx.arc(CX, CY, rOut, 0, TAU)
  ctx.arc(CX, CY, rIn, 0, TAU, true)
  ctx.fillStyle = BRASS_BASE
  ctx.fill()
  // 挡板铜块：图案格 p 落在盘面角 (p + 显示旋转) 格。
  const step = 360 / layer.slots
  for (let p = 0; p < layer.slots; p += 1) {
    if (layer.gaps[p] === true) continue
    const a0 = ((p * step + disp) * Math.PI) / 180
    const a1 = (((p + 1) * step + disp) * Math.PI) / 180
    ctx.beginPath()
    ctx.arc(CX, CY, rOut - 0.5, a0, a1)
    ctx.arc(CX, CY, rIn + 0.5, a1, a0, true)
    ctx.closePath()
    ctx.fillStyle = BRASS_PLATE
    ctx.fill()
    ctx.strokeStyle = BRASS_EDGE
    ctx.lineWidth = 1
    ctx.stroke()
  }
  // 内缘一道高光。
  ctx.beginPath()
  ctx.arc(CX, CY, rIn + 2, 0, TAU)
  ctx.strokeStyle = 'rgba(255,220,150,0.10)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  // 选中层高亮双圈。
  if (selected) {
    ctx.strokeStyle = accent(0)
    ctx.lineWidth = 2
    glow(ctx, accent(0), 8)
    ctx.beginPath()
    ctx.arc(CX, CY, rIn - 1, 0, TAU)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(CX, CY, rOut + 1, 0, TAU)
    ctx.stroke()
    noGlow(ctx)
  }
  // 层号标注（12 点方向静止，画在挡板之上）。
  ctx.font = '600 10px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = selected ? accent(0) : THEME.textMuted
  ctx.fillText(String(i + 1), CX, CY - (rIn + rOut) / 2 + 3)
}

/** 径向光束：中心光珠、逐层绿通/红断线段、全通时射出盘面。 */
function drawBeam(ctx: CanvasRenderingContext2D, state: RotationState): void {
  const layers = state.board.layers
  const angleDeg = currentTargetAngle(state)
  const open = beamAt(state.board, angleDeg)
  const allOpen = open.every(Boolean)
  const rad = (angleDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const seg = (r0: number, r1: number, color: string, width: number): void => {
    ctx.strokeStyle = color
    ctx.lineWidth = width
    glow(ctx, color, 9)
    ctx.beginPath()
    ctx.moveTo(CX + cos * r0, CY + sin * r0)
    ctx.lineTo(CX + cos * r1, CY + sin * r1)
    ctx.stroke()
    noGlow(ctx)
  }
  // 中心到最内层。
  seg(PEARL_R - 3, RING_START, THEME.gold, 5)
  // 逐层通/断。
  for (let i = 0; i < layers.length; i += 1) {
    const { rIn, rOut } = ringRadii(layers.length, i)
    seg(rIn, rOut, open[i] === true ? THEME.good : THEME.bad, 5)
  }
  // 全通：射出盘面 + 出口光斑。
  if (allOpen) {
    seg(BOARD_R, BOARD_R + 14, THEME.gold, 6)
    glow(ctx, THEME.gold, 14)
    ctx.fillStyle = THEME.gold
    ctx.beginPath()
    ctx.arc(CX + cos * (BOARD_R + 14), CY + sin * (BOARD_R + 14), 5, 0, TAU)
    ctx.fill()
    noGlow(ctx)
  }
  // 中心光珠。
  const grad = ctx.createRadialGradient(CX, CY, 1, CX, CY, PEARL_R)
  grad.addColorStop(0, '#fff7dc')
  grad.addColorStop(1, THEME.gold)
  glow(ctx, allOpen ? THEME.good : THEME.gold, 12)
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(CX, CY, PEARL_R, 0, TAU)
  ctx.fill()
  noGlow(ctx)
}

/** 目标角三角标记 + 度数（已完成绿、当前金、待打灰）。 */
function drawMarkers(ctx: CanvasRenderingContext2D, state: RotationState): void {
  const angles = state.board.targetAngles
  for (let k = 0; k < angles.length; k += 1) {
    const deg = angles[k]!
    const rad = (deg * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const done = k < state.targetIndex || state.status === 'won' || state.status === 'cleared'
    const cur = k === state.targetIndex && state.status === 'playing'
    const color = done ? THEME.good : cur ? THEME.gold : THEME.textMuted
    const tipR = BOARD_R + 4
    const baseR = BOARD_R + 18
    const halfW = 6
    const tx = CX + cos * tipR
    const ty = CY + sin * tipR
    const bx = CX + cos * baseR
    const by = CY + sin * baseR
    const px = -sin
    const py = cos
    ctx.beginPath()
    ctx.moveTo(tx, ty)
    ctx.lineTo(bx + px * halfW, by + py * halfW)
    ctx.lineTo(bx - px * halfW, by - py * halfW)
    ctx.closePath()
    ctx.fillStyle = color
    if (cur) glow(ctx, THEME.gold, 8)
    ctx.fill()
    noGlow(ctx)
    ctx.font = (cur ? 'bold 12px' : '600 10px') + ' system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = color
    ctx.fillText(String(deg) + '°', CX + cos * (BOARD_R + 32), CY + sin * (BOARD_R + 32) + 4)
  }
}

/** 顶部 HUD：关卡 / 步数 / 得分 + 第二行目标角进度。 */
function drawHud(ctx: CanvasRenderingContext2D, state: RotationState): void {
  hudPair(ctx, 12, 18, '关卡 ', state.level + '/' + String(LEVEL_COUNT))
  hudPair(ctx, 110, 18, '步数 ', String(state.steps))
  hudPair(ctx, LOGICAL_W - 12, 18, '得分 ', String(state.score), 'right')
  let x = 12
  ctx.font = '600 11px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('目标角', x, 36)
  x += ctx.measureText('目标角 ').width
  const angles = state.board.targetAngles
  for (let k = 0; k < angles.length; k += 1) {
    const done = k < state.targetIndex || state.status !== 'playing'
    const cur = k === state.targetIndex && state.status === 'playing'
    ctx.font = (cur ? 'bold 12px' : '600 11px') + ' system-ui, sans-serif'
    ctx.fillStyle = done ? THEME.good : cur ? THEME.gold : THEME.textMuted
    const label = String(angles[k]) + '° '
    ctx.fillText(label, x, 36)
    x += ctx.measureText(label).width + 4
  }
}

/** 底部操作提示（居中，与说明按钮水平错开）。 */
function drawBottomHint(ctx: CanvasRenderingContext2D): void {
  ctx.font = '600 11px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('点击圆环选层 · ←/→ 旋转 · R 重开 · P 暂停', CX, 530)
}

/** 说明按钮 + 帮助面板（渲染函数末尾、最上层，任何阶段可开合）。 */
function drawHelp(ctx: CanvasRenderingContext2D): void {
  roundRectPath(ctx, HELP_RECT.x, HELP_RECT.y, HELP_RECT.w, HELP_RECT.h, 6)
  ctx.fillStyle = helpOpen ? 'rgba(122,162,247,0.18)' : 'rgba(30,30,42,0.92)'
  ctx.fill()
  ctx.strokeStyle = helpOpen ? accent(0) : THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.font = 'bold 12px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = helpOpen ? accent(0) : THEME.text
  ctx.fillText('说明' + (helpOpen ? ' ×' : ' ?'), HELP_RECT.x + HELP_RECT.w / 2, HELP_RECT.y + 16)
  if (!helpOpen) return
  ctx.fillStyle = 'rgba(13,13,20,0.78)'
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H)
  roundRectPath(ctx, 40, 106, 400, 300, 12)
  ctx.fillStyle = THEME.panel
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.font = 'bold 17px system-ui, sans-serif'
  ctx.fillStyle = THEME.gold
  ctx.fillText(HELP_TITLE, LOGICAL_W / 2, 138)
  ctx.textAlign = 'left'
  ctx.font = '600 15px system-ui, sans-serif'
  ctx.fillStyle = THEME.text
  for (let i = 0; i < HELP_LINES.length; i += 1) {
    ctx.fillText(HELP_LINES[i]!, 64, 176 + i * 27)
  }
}

/** 画一帧。 */
export function renderRotation(ctx: CanvasRenderingContext2D, state: RotationState, view: RotationView): void {
  const now = typeof performance !== 'undefined' ? performance.now() : 0
  const dtMs = prevFrameMs === 0 ? 16 : Math.min(64, now - prevFrameMs)
  prevFrameMs = now
  updateAnim(state, dtMs)

  drawBackground(ctx, LOGICAL_W, LOGICAL_H)
  drawHud(ctx, state)
  const n = state.board.layers.length
  for (let i = 0; i < n; i += 1) {
    drawRing(ctx, state, i, anims.get(i)?.cur ?? 0)
  }
  drawMarkers(ctx, state)
  drawBeam(ctx, state)

  // 过关瞬间在射出点爆一次粒子。
  if (state.status === 'won' && !prevWon) {
    const rad = (currentTargetAngle(state) * Math.PI) / 180
    particles.burst(
      CX + Math.cos(rad) * (BOARD_R + 10), CY + Math.sin(rad) * (BOARD_R + 10),
      THEME.gold, 26, 180,
    )
  }
  prevWon = state.status === 'won'
  particles.tick(ctx, dtMs)

  if (view.paused) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '已暂停', '按 P 继续游戏', THEME.text)
  } else if (state.status === 'won') {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '通路贯通',
      '+' + String(state.score - state.levelStartScore) + ' · 按 N 进入下一关', THEME.good)
    drawBeam(ctx, state)
  } else if (state.status === 'cleared') {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '全部通关', '总分 ' + String(state.score), THEME.gold)
    drawBeam(ctx, state)
  }

  drawBottomHint(ctx)
  drawHelp(ctx)
}
