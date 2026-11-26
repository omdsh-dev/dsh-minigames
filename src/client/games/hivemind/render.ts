/**
 * 蜂群算法 canvas 渲染：深色巢穴风——蜂为带朝向的金色小菱形、邻居连线
 * 淡显（D 调试开关）、红色障碍区脉冲、金色目标圆区、三滑杆调参面板、
 * 指标进度条、关卡 HUD、说明按钮与大字帮助面板（渲染函数末尾最上层）、
 * 暂停/过关/超时/通关 overlay 与过关粒子。使用共享视觉套件（../theme.ts）。
 * 文件内不使用模板字符串。
 */
import type { HiveMindState, TargetSpec } from './logic.ts'
import {
  FIELD, LEVELS, LEVEL_COUNT, W, H, VIEW_R, coverageCount, alignmentScore, meanNearestSpacing,
} from './logic.ts'
import {
  THEME, accent, createParticles, drawBackground, drawOverlay, glow, hudPair, noGlow,
  roundRectPath,
} from '../theme.ts'

/** 固定逻辑画布尺寸（与 logic 的 W/H 一致）。 */
export const LOGICAL_W = W
export const LOGICAL_H = H
/** 顶部 HUD 高度。 */
export const HUD_H = 30

/** 说明按钮矩形（点击开合帮助面板，任何阶段可用）。 */
export const HELP_RECT = { x: 410, y: 4, w: 60, h: 22 }

/** 三条滑杆的轨道几何（trackY 为轨道上缘，h 为轨道高）。 */
export interface SliderTrack {
  /** 参数键。 */
  key: 'sep' | 'ali' | 'coh'
  /** 左侧中文短标。 */
  label: string
  /** 轨道 x。 */
  x: number
  /** 轨道 y。 */
  y: number
  /** 轨道宽。 */
  w: number
  /** 轨道高。 */
  h: number
}

const SLIDER_TRACKS: readonly SliderTrack[] = [
  { key: 'sep', label: '分离', x: 90, y: 478, w: 320, h: 10 },
  { key: 'ali', label: '对齐', x: 90, y: 504, w: 320, h: 10 },
  { key: 'coh', label: '聚合', x: 90, y: 530, w: 320, h: 10 },
] as const

/** 目标说明与指标值文本的基线 y。 */
const OBJECTIVE_TEXT_Y = 562
/** 目标进度条矩形。 */
const PROGRESS_RECT = { x: 16, y: 570, w: 448, h: 12 }

/** 帮助面板文案（15px 大字，规则 + 易误解点）。 */
const HELP_TITLE = '蜂群算法 · 玩法说明'
const HELP_LINES: readonly string[] = [
  '1. 三条滑杆实时调三力：分离=互相推开、',
  '   对齐=朝邻居平均航向看齐、聚合=向邻居质心靠拢。',
  '2. 全聚合蜂群抱成团，全分离四散，对齐主导即鱼群洄游。',
  '3. 每关一个金色目标区/指标，持续满足让进度条走满即过关。',
  '4. 红色障碍区：蜂每次闯入扣 5 分（过关结算时结算）。',
  '5. 超时可按 R 无限重开本关，已得分保留。',
  '6. 空格/P 暂停，D 切换邻居连线（调试），H 开合本说明。',
  '易误解：目标要「持续保持」——瞬时达标不算数，',
  '   中途失守进度条会立即清零重计。',
]

/** 渲染侧视图选项。 */
export interface HiveMindView {
  /** 暂停中（画暂停 overlay，不推进模拟由调用方控制）。 */
  paused: boolean
  /** 是否淡显邻居连线（D 键切换）。 */
  showLinks: boolean
  /** 本帧 dt（ms），驱动粒子与脉冲动画。 */
  dtMs: number
}

// 模块级渲染状态（同一时刻只挂载一个实例）。
const particles = createParticles()
let helpOpen = false
let prevStatus: string = ''

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

/** 帮助面板当前是否打开。 */
export function isHelpOpen(): boolean {
  return helpOpen
}

/** 命中哪条滑杆（命中区为轨道上下各扩 10px 的矩形）。 */
export function sliderAt(x: number, y: number): 'sep' | 'ali' | 'coh' | null {
  for (const t of SLIDER_TRACKS) {
    if (x >= t.x - 6 && x <= t.x + t.w + 6 && y >= t.y - 10 && y <= t.y + t.h + 10) {
      return t.key
    }
  }
  return null
}

/** 滑杆轨道上横坐标 x 对应的参数值（0-2，越界钳制）。 */
export function sliderValueAt(key: 'sep' | 'ali' | 'coh', x: number): number {
  const t = SLIDER_TRACKS.find((s) => s.key === key)!
  return Math.min(2, Math.max(0, ((x - t.x) / t.w) * 2))
}

/** 目标说明一行（关卡 HUD 下方的进度区左侧）。 */
function targetDescription(target: TargetSpec): string {
  switch (target.kind) {
    case 'centroid':
      return '目标：蜂群质心进入金色圆区并保持'
    case 'spacing':
      return '目标：全群平均最近邻间距 ≥ ' + target.minSpacing + '（红区扣分）'
    case 'coverage':
      return '目标：' + target.count + ' 只蜂进入金色圆区并保持'
    case 'alignment':
      return '目标：全群航向对齐度 ≥ ' + target.minAlign + ' 并保持'
    case 'combo':
      return '目标：质心入圈且平均间距 ≥ ' + target.minSpacing
  }
}

/** HUD：关卡 / 时间 / 得分 / 说明按钮（基线 y=21，条高 30）。 */
function drawHud(ctx: CanvasRenderingContext2D, state: HiveMindState): void {
  const level = LEVELS[state.level]!
  const timeLeftS = Math.max(0, Math.ceil((level.timeLimitMs - state.elapsedMs) / 1000))
  hudPair(ctx, 10, 21, '关卡', (state.level + 1) + '/' + LEVEL_COUNT)
  hudPair(ctx, 110, 21, '时间', timeLeftS + 's')
  hudPair(ctx, 400, 21, '得分', String(state.score))
  hudPair(ctx, 320, 21, '撞红', String(state.obstacleHits), 'right', THEME.bad)
  // 说明按钮。
  ctx.save()
  roundRectPath(ctx, HELP_RECT.x, HELP_RECT.y, HELP_RECT.w, HELP_RECT.h, 6)
  ctx.fillStyle = helpOpen ? accent(1) : THEME.panel
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.fillStyle = helpOpen ? '#15151b' : THEME.text
  ctx.fillText('说明', HELP_RECT.x + HELP_RECT.w / 2, HELP_RECT.y + HELP_RECT.h / 2 + 1)
  ctx.restore()
}

/** 场地边框。 */
function drawField(ctx: CanvasRenderingContext2D): void {
  roundRectPath(ctx, FIELD.x, FIELD.y, FIELD.w, FIELD.h, 8)
  ctx.fillStyle = 'rgba(20,18,28,0.55)'
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
}

/** 红色障碍区（半透明圆 + 脉冲描边）。 */
function drawObstacles(ctx: CanvasRenderingContext2D, state: HiveMindState): void {
  const pulse = 0.5 + 0.5 * Math.sin(state.elapsedMs / 380)
  for (const o of LEVELS[state.level]!.obstacles) {
    ctx.beginPath()
    ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(247,118,142,' + (0.12 + 0.08 * pulse).toFixed(3) + ')'
    ctx.fill()
    ctx.strokeStyle = 'rgba(247,118,142,' + (0.45 + 0.4 * pulse).toFixed(3) + ')'
    ctx.lineWidth = 1.5
    ctx.stroke()
  }
}

/** 金色目标圆区（虚线）。 */
function drawTargetZone(ctx: CanvasRenderingContext2D, target: TargetSpec): void {
  const zones: { x: number, y: number, r: number }[] = []
  if (target.kind === 'centroid' || target.kind === 'coverage' || target.kind === 'combo') {
    zones.push({ x: target.x, y: target.y, r: target.r })
  }
  ctx.save()
  ctx.setLineDash([6, 5])
  for (const z of zones) {
    ctx.beginPath()
    ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(224,175,104,0.7)'
    ctx.lineWidth = 1.5
    ctx.stroke()
  }
  ctx.restore()
}

/** 邻居连线（调试淡显，VIEW_R 内的蜂对）。 */
function drawLinks(ctx: CanvasRenderingContext2D, state: HiveMindState): void {
  ctx.save()
  ctx.strokeStyle = 'rgba(122,162,247,0.10)'
  ctx.lineWidth = 0.5
  ctx.beginPath()
  const bees = state.bees
  for (let i = 0; i < bees.length; i += 1) {
    const a = bees[i]!
    for (let j = i + 1; j < bees.length; j += 1) {
      const b = bees[j]!
      if (Math.abs(a.x - b.x) > VIEW_R || Math.abs(a.y - b.y) > VIEW_R) continue
      if (Math.hypot(a.x - b.x, a.y - b.y) > VIEW_R) continue
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
    }
  }
  ctx.stroke()
  ctx.restore()
}

/** 蜂群：金色小菱形，长轴朝航向。 */
function drawBees(ctx: CanvasRenderingContext2D, state: HiveMindState): void {
  ctx.fillStyle = THEME.gold
  for (const b of state.bees) {
    const c = Math.cos(b.heading)
    const s = Math.sin(b.heading)
    // 菱形四点：前 5、后 4、侧 2.6（沿航向的细长菱形）。
    ctx.beginPath()
    ctx.moveTo(b.x + c * 5, b.y + s * 5)
    ctx.lineTo(b.x - c * 4 - s * 2.6, b.y - s * 4 + c * 2.6)
    ctx.lineTo(b.x - c * 4, b.y - s * 4)
    ctx.lineTo(b.x - c * 4 + s * 2.6, b.y - s * 4 - c * 2.6)
    ctx.closePath()
    ctx.fill()
  }
  // 质心标记：小圆环。
  let sx = 0
  let sy = 0
  for (const b of state.bees) {
    sx += b.x
    sy += b.y
  }
  const cx = sx / state.bees.length
  const cy = sy / state.bees.length
  ctx.beginPath()
  ctx.arc(cx, cy, 4, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(224,175,104,0.9)'
  ctx.lineWidth = 1.5
  ctx.stroke()
}

/** 三滑杆调参面板。 */
function drawSliders(ctx: CanvasRenderingContext2D, state: HiveMindState): void {
  ctx.textBaseline = 'middle'
  for (const t of SLIDER_TRACKS) {
    const value = state.params[t.key]
    const midY = t.y + t.h / 2
    // 标签。
    ctx.font = '600 13px system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillStyle = accent(t.key === 'sep' ? 4 : t.key === 'ali' ? 1 : 3)
    ctx.fillText(t.label, 16, midY)
    // 轨道。
    roundRectPath(ctx, t.x, t.y, t.w, t.h, 5)
    ctx.fillStyle = THEME.panel
    ctx.fill()
    // 填充段（值 0-2 映射轨道半/全宽）。
    const fillW = (t.w / 2) * value
    if (fillW > 1) {
      roundRectPath(ctx, t.x, t.y, fillW, t.h, 5)
      ctx.fillStyle = accent(t.key === 'sep' ? 4 : t.key === 'ali' ? 1 : 3)
      ctx.fill()
    }
    // 滑块旋钮。
    const knobX = t.x + (t.w / 2) * value
    ctx.beginPath()
    ctx.arc(knobX, midY, 7, 0, Math.PI * 2)
    ctx.fillStyle = THEME.text
    ctx.fill()
    // 数值（右锚，定宽 toFixed(2)）。
    ctx.textAlign = 'right'
    ctx.fillStyle = THEME.text
    ctx.fillText(value.toFixed(2), 466, midY)
  }
  ctx.textBaseline = 'alphabetic'
}

/** 目标说明 + 当前指标值 + 持续满足进度条。 */
function drawObjective(ctx: CanvasRenderingContext2D, state: HiveMindState): void {
  const level = LEVELS[state.level]!
  const target = level.target
  const c = { x: 0, y: 0 }
  for (const b of state.bees) {
    c.x += b.x
    c.y += b.y
  }
  c.x /= state.bees.length
  c.y /= state.bees.length
  let metricText = ''
  if (target.kind === 'centroid') {
    metricText = '质心距 ' + Math.hypot(c.x - target.x, c.y - target.y).toFixed(0) + '/' + target.r
  } else if (target.kind === 'spacing') {
    metricText = '平均间距 ' + minSpacingOf(state).toFixed(1) + '/' + target.minSpacing
  } else if (target.kind === 'coverage') {
    metricText = '入圈 ' + coverageOf(state, target.x, target.y, target.r) + '/' + target.count
  } else if (target.kind === 'alignment') {
    metricText = '对齐 ' + alignmentOf(state).toFixed(2) + '/' + target.minAlign
  } else {
    metricText = '质心距 ' + Math.hypot(c.x - target.x, c.y - target.y).toFixed(0)
      + ' 平均间距 ' + minSpacingOf(state).toFixed(1)
  }
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText(targetDescription(target), 16, OBJECTIVE_TEXT_Y)
  ctx.textAlign = 'right'
  ctx.fillStyle = THEME.text
  ctx.fillText(metricText, 464, OBJECTIVE_TEXT_Y)
  // 进度条：持续满足 hold 计时长占比。
  const frac = Math.min(1, state.holdMs / level.holdMs)
  roundRectPath(ctx, PROGRESS_RECT.x, PROGRESS_RECT.y, PROGRESS_RECT.w, PROGRESS_RECT.h, 6)
  ctx.fillStyle = THEME.panel
  ctx.fill()
  if (frac > 0) {
    const fillW = PROGRESS_RECT.w * frac
    roundRectPath(ctx, PROGRESS_RECT.x, PROGRESS_RECT.y, fillW, PROGRESS_RECT.h, 6)
    ctx.fillStyle = frac >= 1 ? THEME.good : THEME.gold
    glow(ctx, THEME.gold, 6)
    ctx.fill()
    noGlow(ctx)
  }
}

/** 平均最近邻间距（渲染进度用，转调 logic 指标）。 */
function minSpacingOf(state: HiveMindState): number {
  return meanNearestSpacing(state.bees)
}

/** 入圈蜂数。 */
function coverageOf(state: HiveMindState, x: number, y: number, r: number): number {
  return coverageCount(state.bees, x, y, r)
}

/** 对齐度。 */
function alignmentOf(state: HiveMindState): number {
  return alignmentScore(state.bees)
}

/** 帮助面板：半透明全屏背板 + 居中面板 + 大字规则（渲染最上层）。 */
function drawHelp(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = 'rgba(13,13,20,0.74)'
  ctx.fillRect(0, 0, W, H)
  const px = 36
  const py = 110
  const pw = 408
  const ph = 386
  roundRectPath(ctx, px, py, pw, ph, 10)
  ctx.fillStyle = THEME.panel
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.font = 'bold 16px system-ui, sans-serif'
  ctx.fillStyle = THEME.text
  ctx.fillText(HELP_TITLE, px + pw / 2, py + 34)
  ctx.textAlign = 'left'
  ctx.font = '500 15px system-ui, sans-serif'
  ctx.fillStyle = THEME.textMuted
  let y = py + 66
  for (const line of HELP_LINES) {
    ctx.fillText(line, px + 24, y)
    y += 24
  }
  ctx.textAlign = 'center'
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('点说明按钮或按 H 关闭', px + pw / 2, py + ph - 16)
}

/** 主渲染入口：整帧绘制（帮助面板最后画，位于最上层）。 */
export function renderHiveMind(ctx: CanvasRenderingContext2D, state: HiveMindState, view: HiveMindView): void {
  drawBackground(ctx, W, H)
  drawHud(ctx, state)
  drawField(ctx)
  const target = LEVELS[state.level]!.target
  drawTargetZone(ctx, target)
  drawObstacles(ctx, state)
  if (view.showLinks) drawLinks(ctx, state)
  drawBees(ctx, state)
  particles.tick(ctx, view.dtMs)
  drawSliders(ctx, state)
  drawObjective(ctx, state)
  // 过关瞬间放一次粒子。
  let burstX = W / 2
  let burstY = FIELD.y + FIELD.h / 2
  {
    let sx = 0
    let sy = 0
    for (const b of state.bees) {
      sx += b.x
      sy += b.y
    }
    burstX = sx / state.bees.length
    burstY = sy / state.bees.length
  }
  if (state.status !== prevStatus) {
    prevStatus = state.status
    if (state.status === 'won' || state.status === 'complete') {
      particles.burst(burstX, burstY, THEME.gold, 26, 170)
    }
  }
  if (view.paused && state.status === 'playing') {
    drawOverlay(ctx, W, H, '已暂停', '空格继续 · H 说明 · R 重开')
  } else if (state.status === 'won') {
    drawOverlay(ctx, W, H, '过关', '得分 ' + state.score + ' · N 下一关 · R 重打', THEME.good)
  } else if (state.status === 'timeout') {
    drawOverlay(ctx, W, H, '时间到', 'R 重开本关（分数保留）', THEME.bad)
  } else if (state.status === 'complete') {
    drawOverlay(ctx, W, H, '全部通关', '总分 ' + state.score + ' · R 重开第 1 关', THEME.gold)
  }
  if (helpOpen) drawHelp(ctx)
}
