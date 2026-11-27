/**
 * 轨道交会 OrbitDock 渲染层：太空指挥风。星点背景 + 中心行星 +
 * 空间站（带轨道虚线与对接圈提示）+ 碎片带 + 飞船轨迹渐隐线与
 * 速度矢量箭头；暂停规划态在飞船处画待执行 ΔV 箭头与标签。HUD：
 * 关卡 / 脉冲次数 / ΔV 条 / 距离与相对速度读数（右锚动态文本）。
 * 帮助面板与「说明」按钮画在渲染函数末尾（最上层），任何阶段可开合。
 * 渲染按 state.status 显式分支：playing+running（飞行态）、
 * playing+!running（规划态：ΔV 箭头）、docked / failed / allClear
 * （对应过关 / 失败 / 通关遮罩），每格各走哪个分支见 renderOrbitDock。
 * 全部绘制为纯函数，不持有游戏状态（粒子池与拖拽矢量由 index 注入）。
 */
import { THEME, drawBackground, drawOverlay, glow, hudPair, noGlow, roundRectPath } from '../theme.ts'
import type { ParticleSystem } from '../theme.ts'
import {
  CY, CX, DEBRIS_R, DOCK_DIST, DOCK_SPEED, LEVELS, LOGICAL_H, LOGICAL_W, MAX_BURNS,
  PLANET_R, debrisPos, failText, stationAt,
  type DockState,
} from './logic.ts'

/** 「说明」按钮矩形（渲染在最上层，点击命中由 index.ts 复用本常量）。 */
export const HELP_RECT = { x: LOGICAL_W - 74, y: 8, w: 60, h: 24 }
/** ΔV 余量条矩形（HUD 第一行，右侧与读数留白）。 */
const DV_BAR = { x: 270, y: 13, w: 110, h: 11 }
/** 右侧动态读数的右锚 x（与说明按钮左缘留 12px）。 */
const READ_RIGHT = LOGICAL_W - 86
/** 帮助面板矩形（居中，盖在盘面之上）。 */
const HELP_PANEL = { x: 120, y: 90, w: 400, h: 302 }

/** 帮助面板的八行完整规则（15px 大字）。 */
const HELP_LINES: string[] = [
  '目标：与空间站交会——距离 ≤ 20px 且相对速度 ≤ 25，',
  '两条件同时满足并保持 2 秒，即对接成功。',
  '全程只有 2 次脉冲：暂停时从飞船拖出箭头设定 ΔV',
  '（方向 + 强度），按空格立即执行并继续飞行。',
  '思路：先做半椭圆转移轨道换到空间站轨道半径，',
  '等相位对齐后再用第二脉冲把速度对齐空间站，',
  '只对位置不对速度是新手最常犯的错。',
  '撞行星 / 碎片、飞出空域或 ΔV 用尽超时都判失败。',
  'R 重开本关 · P 暂停 · 共 5 关，预算越来越紧。',
]

/** 渲染所需的视图状态（由 index.ts 维护）。 */
export interface OrbitDockView {
  /** 模拟是否推进中（false = 规划态）。 */
  running: boolean
  /** P 暂停遮罩。 */
  paused: boolean
  /** 帮助面板是否展开。 */
  helpOpen: boolean
  /** 粒子系统（index 持有，此处只按帧推进）。 */
  particles: ParticleSystem
  /** 距上帧毫秒。 */
  dtMs: number
  /** 星点背景（seed 生成一次）。 */
  stars: { x: number, y: number, r: number, a: number }[]
  /** 拖拽中的 ΔV 矢量（px/s；null = 无拖拽）。 */
  drag: { x: number, y: number } | null
}

/** 画星点背景。 */
function drawStars(ctx: CanvasRenderingContext2D, view: OrbitDockView): void {
  ctx.fillStyle = THEME.text
  for (const s of view.stars) {
    ctx.globalAlpha = s.a
    ctx.beginPath()
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

/** 画中心行星（径向渐变球 + 光晕）。 */
function drawPlanet(ctx: CanvasRenderingContext2D): void {
  glow(ctx, THEME.accents[4]!, 18)
  const g = ctx.createRadialGradient(CX - 8, CY - 8, 4, CX, CY, PLANET_R)
  g.addColorStop(0, '#8a6ee0')
  g.addColorStop(0.6, '#5b4a9e')
  g.addColorStop(1, '#2c2452')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(CX, CY, PLANET_R, 0, Math.PI * 2)
  ctx.fill()
  noGlow(ctx)
}

/** 画轨道参考线：初始轨道 / 空间站轨道 / 碎片环（虚线）。 */
function drawGuides(ctx: CanvasRenderingContext2D, state: DockState): void {
  const cfg = LEVELS[state.level - 1]!
  ctx.setLineDash([5, 7])
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(125,207,255,0.22)'
  ctx.beginPath()
  ctx.arc(CX, CY, cfg.r0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(158,206,106,0.32)'
  ctx.beginPath()
  ctx.arc(CX, CY, cfg.rS, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(148,163,184,0.18)'
  for (const chunk of state.debris) {
    ctx.beginPath()
    ctx.arc(CX, CY, chunk.orbitR, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.setLineDash([])
  // 碎片实体。
  ctx.fillStyle = '#5b6478'
  for (const chunk of state.debris) {
    const p = debrisPos(chunk, state.t)
    ctx.beginPath()
    ctx.arc(p.x, p.y, DEBRIS_R, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** 画飞船轨迹渐隐线（越旧越透明）。 */
function drawTrail(ctx: CanvasRenderingContext2D, state: DockState): void {
  const pts = state.trail
  if (pts.length < 4) return
  ctx.lineWidth = 1.5
  const n = pts.length / 2
  for (let i = 1; i < n; i += 1) {
    const x0 = pts[(i - 1) * 2]!
    const y0 = pts[(i - 1) * 2 + 1]!
    const x1 = pts[i * 2]!
    const y1 = pts[i * 2 + 1]!
    ctx.globalAlpha = 0.08 + 0.42 * (i / n)
    ctx.strokeStyle = THEME.accents[6]!
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

/** 画飞船：沿速度方向的三角 + 光晕。 */
function drawShip(ctx: CanvasRenderingContext2D, state: DockState): void {
  const s = state.ship
  const ang = Math.atan2(s.vy, s.vx)
  ctx.save()
  ctx.translate(s.x, s.y)
  ctx.rotate(ang)
  glow(ctx, THEME.accents[6]!, 10)
  ctx.fillStyle = THEME.text
  ctx.beginPath()
  ctx.moveTo(8, 0)
  ctx.lineTo(-6, 5)
  ctx.lineTo(-3, 0)
  ctx.lineTo(-6, -5)
  ctx.closePath()
  ctx.fill()
  noGlow(ctx)
  ctx.restore()
}

/** 画空间站：本体 + 太阳能板 + 接近时的对接圈。 */
function drawStation(ctx: CanvasRenderingContext2D, state: DockState): void {
  const cfg = LEVELS[state.level - 1]!
  const st = stationAt(cfg, state.t)
  const d = Math.hypot(state.ship.x - st.x, state.ship.y - st.y)
  if (d < 120) {
    // 对接圈提示：绿=双条件满足，蓝=距离近但速度未对齐。
    const stV = Math.hypot(state.ship.vx - st.vx, state.ship.vy - st.vy)
    ctx.setLineDash([4, 4])
    ctx.lineWidth = 1.2
    ctx.strokeStyle = d <= DOCK_DIST && stV <= DOCK_SPEED ? THEME.good : 'rgba(122,162,247,0.55)'
    ctx.beginPath()
    ctx.arc(st.x, st.y, DOCK_DIST, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
  }
  ctx.save()
  ctx.translate(st.x, st.y)
  ctx.rotate(Math.atan2(st.vy, st.vx))
  ctx.fillStyle = '#7aa2f7'
  ctx.fillRect(-18, -4, 8, 8)
  ctx.fillRect(10, -4, 8, 8)
  glow(ctx, THEME.good, 8)
  ctx.fillStyle = '#c5c9d6'
  ctx.fillRect(-8, -5, 16, 10)
  noGlow(ctx)
  ctx.restore()
}

/** HUD：第一行关卡/脉冲/ΔV 条 + 右侧距离，第二行提示 + 右侧相对速度。 */
function drawHud(ctx: CanvasRenderingContext2D, state: DockState): void {
  const cfg = LEVELS[state.level - 1]!
  hudPair(ctx, 12, 24, '关卡 ', state.level + '/' + LEVELS.length)
  hudPair(ctx, 100, 24, '脉冲 ', state.burnsUsed + '/' + MAX_BURNS)
  hudPair(ctx, 190, 24, 'ΔV ', state.dvLeft.toFixed(1), 'left', state.dvLeft < 6 ? THEME.bad : THEME.gold)
  // ΔV 余量条。
  roundRectPath(ctx, DV_BAR.x, DV_BAR.y, DV_BAR.w, DV_BAR.h, 5)
  ctx.fillStyle = 'rgba(255,255,255,0.06)'
  ctx.fill()
  const ratio = Math.max(0, Math.min(1, state.dvLeft / state.dvBudget))
  if (ratio > 0) {
    roundRectPath(ctx, DV_BAR.x, DV_BAR.y, Math.max(DV_BAR.h, DV_BAR.w * ratio), DV_BAR.h, 5)
    ctx.fillStyle = state.dvLeft < 6 ? THEME.bad : THEME.gold
    ctx.fill()
  }
  // 右侧动态读数：右锚，避免动态字宽变化导致越界 / 重叠。
  const st = stationAt(cfg, state.t)
  const d = Math.hypot(state.ship.x - st.x, state.ship.y - st.y)
  const vrel = Math.hypot(state.ship.vx - st.vx, state.ship.vy - st.vy)
  hudPair(ctx, READ_RIGHT, 24, '距离 ', d.toFixed(0) + ' px', 'right', d <= DOCK_DIST ? THEME.good : THEME.text)
  hudPair(ctx, READ_RIGHT, 42, '相对速度 ', vrel.toFixed(1), 'right', vrel <= DOCK_SPEED ? THEME.good : THEME.text)
  ctx.font = '600 11px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('暂停时拖箭头设定脉冲 · 空格执行 · R 重开 · P 暂停', 12, 42)
}

/** 规划态：飞船处画待执行 ΔV 箭头 + 数值标签 + 新航向预览虚线。 */
function drawPlanArrow(ctx: CanvasRenderingContext2D, state: DockState, view: OrbitDockView): void {
  const dv = view.drag !== null ? view.drag : state.pending
  if (dv === null) return
  const s = state.ship
  const mag = Math.hypot(dv.x, dv.y)
  if (mag < 0.5) return
  const ux = dv.x / mag
  const uy = dv.y / mag
  const len = 14 + mag * 2.2
  const tx = s.x + ux * len
  const ty = s.y + uy * len
  // 新航向预览：当前速度 + ΔV 后的方向。
  ctx.setLineDash([3, 4])
  ctx.strokeStyle = 'rgba(226,226,238,0.4)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(s.x, s.y)
  ctx.lineTo(s.x + (s.vx + dv.x) * 0.22, s.y + (s.vy + dv.y) * 0.22)
  ctx.stroke()
  ctx.setLineDash([])
  // ΔV 箭头。
  glow(ctx, THEME.accents[3]!, 8)
  ctx.strokeStyle = THEME.gold
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.moveTo(s.x, s.y)
  ctx.lineTo(tx, ty)
  ctx.stroke()
  noGlow(ctx)
  ctx.beginPath()
  ctx.moveTo(tx, ty)
  ctx.lineTo(tx - ux * 9 - uy * 4, ty - uy * 9 + ux * 4)
  ctx.lineTo(tx - ux * 9 + uy * 4, ty - uy * 9 - ux * 4)
  ctx.closePath()
  ctx.fillStyle = THEME.gold
  ctx.fill()
  // 数值标签：锚在箭头尖端外推 14px，钳回画布内。
  ctx.font = 'bold 12px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = THEME.gold
  ctx.fillText('ΔV ' + mag.toFixed(1), Math.max(60, Math.min(LOGICAL_W - 60, tx + ux * 16)), Math.max(60, Math.min(LOGICAL_H - 16, ty + uy * 16)))
  ctx.textAlign = 'left'
}

/** 帮助面板与「说明」按钮（渲染函数末尾调用，最上层）。 */
function drawHelp(ctx: CanvasRenderingContext2D, helpOpen: boolean): void {
  // 按钮：任何阶段常显。
  roundRectPath(ctx, HELP_RECT.x, HELP_RECT.y, HELP_RECT.w, HELP_RECT.h, 6)
  ctx.fillStyle = helpOpen ? THEME.panelEdge : 'rgba(30,30,42,0.88)'
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = THEME.text
  ctx.fillText(helpOpen ? '关闭' : '说明', HELP_RECT.x + HELP_RECT.w / 2, HELP_RECT.y + 16)
  ctx.textAlign = 'left'
  if (!helpOpen) return
  // 面板。
  roundRectPath(ctx, HELP_PANEL.x, HELP_PANEL.y, HELP_PANEL.w, HELP_PANEL.h, 10)
  ctx.fillStyle = 'rgba(16,16,26,0.94)'
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.stroke()
  ctx.font = 'bold 17px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = THEME.text
  ctx.fillText('轨道交会 · 规则', HELP_PANEL.x + HELP_PANEL.w / 2, HELP_PANEL.y + 34)
  ctx.font = '15px system-ui, sans-serif'
  ctx.fillStyle = 'rgba(226,226,238,0.86)'
  for (let i = 0; i < HELP_LINES.length; i += 1) {
    ctx.fillText(HELP_LINES[i]!, HELP_PANEL.x + HELP_PANEL.w / 2, HELP_PANEL.y + 64 + i * 26)
  }
  ctx.textAlign = 'left'
}

/**
 * 渲染一帧。状态分支（渲染 dispatch 按状态字段显式分支）：
 * - status playing & running：飞行态——轨迹 / 飞船 / 读数全部实时。
 * - status playing & !running：规划态——在飞行态画面之上叠 ΔV 箭头。
 * - status docked：过关遮罩（下一关待流转）。
 * - status failed：失败遮罩（原因文案 + R 重开）。
 * - status allClear：通关遮罩（总分 + R 重开）。
 * 帮助面板最后画，盖过一切遮罩。
 * @param ctx - 画布上下文（已套逻辑坐标变换）。
 * @param state - 当前局面。
 * @param view - 视图状态。
 */
export function renderOrbitDock(ctx: CanvasRenderingContext2D, state: DockState, view: OrbitDockView): void {
  drawBackground(ctx, LOGICAL_W, LOGICAL_H)
  drawStars(ctx, view)
  drawPlanet(ctx)
  drawGuides(ctx, state)
  drawTrail(ctx, state)
  drawStation(ctx, state)
  drawShip(ctx, state)
  // 规划态：飞行态画面之上叠脉冲箭头（仅 playing 且未推进时）。
  if (state.status === 'playing' && !view.running && !view.paused) drawPlanArrow(ctx, state, view)
  drawHud(ctx, state)
  view.particles.tick(ctx, view.dtMs)
  if (state.status === 'docked') {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '交 会 成 功', '剩余 ΔV ' + state.dvLeft.toFixed(1) + ' 折算加分 · 空格进入下一关', THEME.good)
  } else if (state.status === 'allClear') {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '全 部 对 接 完 成', '总分 ' + state.scoreTotal + ' · R 重新开始', THEME.gold)
  } else if (state.status === 'failed') {
    const reason = state.failReason === null ? '' : failText(state.failReason)
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '对 接 失 败', reason + ' · R 重开本关', THEME.bad)
  } else if (view.paused) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '已 暂 停', '按 P 继续 · 暂停中仍可拖箭头设定脉冲')
  }
  drawHelp(ctx, view.helpOpen)
}
