/**
 * 烟花编排 FireworksShow 渲染层：夜空庆典（星点闪烁、发射架位、升空
 * 轨迹、按配方形状的绽放粒子）、目标谱清单（pending/hit/miss 三态打勾）、
 * 配方选择面板 + 延时滑条（0-5 秒，1 秒粒度）、点火按钮、说明按钮与
 * 帮助面板（渲染末尾最上层）。纯绘制无状态，布局常量集中声明并核算
 * 互不遮挡：HUD 行 y26 左 x16 / 中 x233 / 右 x704（三段净距 ≥150px）；
 * 夜空 16-450 x 36-380；发射位排 16-450 x 388-436；点火按钮 16-126 x
 * 444-470；底提示文案 (233, 496) 与说明按钮 644-704 x 528-552 同带净距
 * ≥400px；右栏目标谱 460-704 x 36-300、编辑器 460-704 x 312-516；全部
 * 在 720x560 逻辑画布内。无反引号模板字符串。
 */
import { describeItem, type Assignment, type BurstEvent, type GameState, type ItemState, type LevelData, type Recipe, RECIPES, starsForLevel } from './logic.ts'
import { accent, drawBackground, glow, hudPair, noGlow, roundRectPath, THEME } from '../theme.ts'

/** 逻辑画布尺寸。 */
export const LOGICAL_W = 720
export const LOGICAL_H = 560

/** 逻辑矩形（布局核算用）。 */
interface Rect { x: number; y: number; w: number; h: number }

/** 夜空区域（星点 + 绽放 + 升空轨迹）。 */
const SKY: Rect = { x: 16, y: 36, w: 434, h: 344 }
/** 发射位排（夜空正下方）。 */
const PADS: Rect = { x: 16, y: 388, w: 434, h: 48 }
/** 点火按钮。 */
export const IGNITE_BTN = { x: 16, y: 444, w: 110, h: 26 }
/** 目标谱面板（右栏上）。 */
const SPECTRUM_PANEL: Rect = { x: 460, y: 36, w: 244, h: 264 }
/** 装配编辑器面板（右栏下）。 */
const EDITOR_PANEL: Rect = { x: 460, y: 312, w: 244, h: 204 }
/** 说明按钮（右下角，60x24）。 */
export const HELP_BTN = { x: LOGICAL_W - 76, y: LOGICAL_H - 32, w: 60, h: 24 }
/** 帮助面板矩形。 */
const HELP_PANEL = { x: LOGICAL_W / 2 - 280, y: LOGICAL_H - 216, w: 560, h: 196 }
/** 帮助面板文案（15-16px 大字，完整规则 + 易误解点）。 */
const HELP_LINES = [
  '烟花编排速览',
  '· 9 种配方查表：金/红/蓝/绿/紫/青/橙/白×菊(放射)/牡丹(多层)/环(环形)/柳(垂枝)',
  '· 引信延时 0-5 秒：绽放时刻 = 延时 + 升空时长（配方表第二列），1 秒粒度排程',
  '· 目标谱「3.0s：金色菊花 ×2 同放」= 该瞬间天空里同时亮着 2 朵金菊（含绽放瞬间）',
  '· 「柳形要最后落下」= 全场最晚熄灭的一朵必须是柳形（柳燃程最长，延时别太大）',
  '· 风关（第 4/5 关）：奇数位发射架点火后多飞 1 秒才绽放——排程时要避开这个偏移',
  '· 点击发射位→选配方→拖延时滑条；空格或点火按钮点火，看完整个演出自动结算',
  '· R 重开本关 · P 暂停 · 过关自动进入下一关并保存进度',
]

/**
 * 发射位卡片矩形：发射位排在 PADS 区域内均分（间隙 6px，自适应关卡位数）。
 * @param padCount - 发射位数量。
 * @param index - 发射位下标。
 * @returns 卡片矩形。
 */
export function padRect(padCount: number, index: number): { x: number; y: number; w: number; h: number } {
  const gap = 6
  const w = (PADS.w - gap * (padCount - 1)) / padCount
  return { x: PADS.x + index * (w + gap), y: PADS.y, w, h: PADS.h }
}

/**
 * 命中发射位（发射架位区域）。运行阶段不可选。
 * @param padCount - 发射位数量。
 * @param px - 逻辑 x。
 * @param py - 逻辑 y。
 * @returns 发射位下标，未命中返回 null。
 */
export function padFromPoint(padCount: number, px: number, py: number): number | null {
  for (let i = 0; i < padCount; i += 1) {
    const r = padRect(padCount, i)
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return i
  }
  return null
}

/**
 * 编辑器里的配方按钮矩形（3x3 网格，行 = 形状分组无关，仅布局）。
 * @param index - 配方下标（0-8）。
 * @returns 按钮矩形。
 */
export function recipeBtnRect(index: number): { x: number; y: number; w: number; h: number } {
  const col = index % 3
  const row = Math.floor(index / 3)
  const w = 70
  const h = 30
  return { x: EDITOR_PANEL.x + 12 + col * (w + 6), y: EDITOR_PANEL.y + 46 + row * (h + 6), w, h }
}

/**
 * 命中编辑器配方按钮。
 * @param px - 逻辑 x。
 * @param py - 逻辑 y。
 * @returns 配方下标，未命中返回 null。
 */
export function recipeBtnFromPoint(px: number, py: number): number | null {
  for (let i = 0; i < RECIPES.length; i += 1) {
    const r = recipeBtnRect(i)
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return i
  }
  return null
}

/** 延时滑条轨道（60px 宽端距，0 秒在左、5 秒在右）。 */
const SLIDER = { x: EDITOR_PANEL.x + 22, y: EDITOR_PANEL.y + 176, w: 200, h: 8 }

/**
 * 延时滑条取值：轨道 x → 0-5 秒（钳制）。
 * @param px - 逻辑 x。
 * @returns 延时秒（0-5 整数）。
 */
export function sliderValueFromPoint(px: number): number {
  const t = (px - SLIDER.x) / SLIDER.w
  return Math.min(Math.max(Math.round(t * 5), 0), 5)
}

/**
 * 是否点在延时滑条轨道热区（上下扩 14px 便于拖拽）。
 * @param px - 逻辑 x。
 * @param py - 逻辑 y。
 * @returns 是否命中。
 */
export function sliderHit(px: number, py: number): boolean {
  return px >= SLIDER.x - 6 && px <= SLIDER.x + SLIDER.w + 6 && py >= SLIDER.y - 14 && py <= SLIDER.y + 22
}

/** 是否点在点火按钮。 */
export function igniteHit(px: number, py: number): boolean {
  return px >= IGNITE_BTN.x && px <= IGNITE_BTN.x + IGNITE_BTN.w && py >= IGNITE_BTN.y && py <= IGNITE_BTN.y + IGNITE_BTN.h
}

/** 一帧的完整绘制视图（index 层组装）。 */
export interface SceneView {
  /** 游戏状态。 */
  state: GameState
  /** 当前关卡。 */
  level: LevelData
  /** HUD 关卡值（如 '1/5'）。 */
  hudLevel: string
  /** HUD 右栏值（setup=点火次数，running=回放时刻，done=得分）。 */
  hudRight: string
  /** HUD 右栏标签。 */
  hudRightLabel: string
  /** 谱项三态（与关卡 items 一一对应）。 */
  itemStates: ItemState[]
}

/**
 * 事件相对当前时刻的显式三态（渲染分发必须三分支：历史事故 C）。
 * @param event - 绽放事件。
 * @param time - 当前回放 tick。
 * @returns 'rising' 升空中 / 'blooming' 绽放中 / 'done' 已熄灭。
 */
function eventPhase(event: BurstEvent, time: number): 'rising' | 'blooming' | 'done' {
  if (time < event.burst) return 'rising'
  if (time < event.end) return 'blooming'
  return 'done'
}

/** 绽放中心：发射位 x 对齐 + 爆高映射到夜空。 */
function burstCenter(level: LevelData, event: BurstEvent): { x: number; y: number } {
  const pad = padRect(level.pads, event.pad)
  return { x: pad.x + pad.w / 2, y: SKY.y + (SKY.h - event.height) }
}

/**
 * 升空轨迹（rising 分支）：从发射架到爆高的亮头 + 渐隐尾迹。
 * @param ctx - 画布上下文。
 * @param level - 关卡。
 * @param event - 事件。
 * @param progress - 升空进度 0-1。
 */
function drawRising(ctx: CanvasRenderingContext2D, level: LevelData, event: BurstEvent, progress: number): void {
  const c = burstCenter(level, event)
  const startX = c.x
  const startY = SKY.y + SKY.h - 8
  const eased = 1 - (1 - progress) * (1 - progress)
  const x = startX
  const y = startY + (c.y - startY) * eased
  ctx.strokeStyle = event.color
  ctx.globalAlpha = 0.5
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(startX, startY)
  ctx.lineTo(x, y)
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.fillStyle = '#e2e2ee'
  glow(ctx, event.color, 10)
  ctx.beginPath()
  ctx.arc(x, y, 2.6, 0, Math.PI * 2)
  ctx.fill()
  noGlow(ctx)
}

/**
 * 绽放形状绘制（blooming 分支，按配方形状显式分派）。
 * 菊=放射光针 + 端点星、牡丹=三层同心点环、环=单圈描边、柳=下垂枝条。
 * @param ctx - 画布上下文。
 * @param event - 事件。
 * @param cx - 中心 x。
 * @param cy - 中心 y。
 * @param progress - 绽放进度 0-1。
 */
function drawBloom(ctx: CanvasRenderingContext2D, event: BurstEvent, cx: number, cy: number, progress: number): void {
  const radius = 34 + event.height * 0.1
  const alpha = progress < 0.7 ? 1 : Math.max(0, (1 - progress) / 0.3)
  ctx.globalAlpha = alpha
  ctx.strokeStyle = event.color
  ctx.fillStyle = event.color
  if (event.shape === 'chrys') {
    const rays = 16
    const len = radius * (0.25 + 0.75 * progress)
    ctx.lineWidth = 1.6
    glow(ctx, event.color, 8)
    for (let i = 0; i < rays; i += 1) {
      const a = (i / rays) * Math.PI * 2
      const ex = cx + Math.cos(a) * len
      const ey = cy + Math.sin(a) * len
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(a) * len * 0.2, cy + Math.sin(a) * len * 0.2)
      ctx.lineTo(ex, ey)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(ex, ey, 2.2, 0, Math.PI * 2)
      ctx.fill()
    }
    noGlow(ctx)
  } else if (event.shape === 'peony') {
    glow(ctx, event.color, 8)
    for (let layer = 1; layer <= 3; layer += 1) {
      const r = radius * layer * 0.32 * progress
      const dots = 10 + layer * 5
      for (let i = 0; i < dots; i += 1) {
        const a = (i / dots) * Math.PI * 2 + layer * 0.35
        ctx.beginPath()
        ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2.4, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    noGlow(ctx)
  } else if (event.shape === 'ring') {
    glow(ctx, event.color, 10)
    ctx.lineWidth = 2.4
    ctx.beginPath()
    ctx.arc(cx, cy, radius * 0.92 * progress, 0, Math.PI * 2)
    ctx.stroke()
    ctx.lineWidth = 1
    const dots = 14
    for (let i = 0; i < dots; i += 1) {
      const a = (i / dots) * Math.PI * 2
      const r = radius * 0.92 * progress
      ctx.beginPath()
      ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2, 0, Math.PI * 2)
      ctx.fill()
    }
    noGlow(ctx)
  } else {
    // 柳：12 条下垂枝——先外扩后垂落，进度越深垂得越长。
    glow(ctx, event.color, 7)
    ctx.lineWidth = 1.4
    const branches = 12
    for (let i = 0; i < branches; i += 1) {
      const a = (i / branches) * Math.PI * 2
      const reach = radius * 0.5
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(a) * reach * 0.3, cy + Math.sin(a) * reach * 0.3)
      for (let s = 1; s <= 6; s += 1) {
        const t = (s / 6) * progress
        const drop = t * t * 46
        ctx.lineTo(cx + Math.cos(a) * (reach * 0.3 + reach * 0.7 * t), cy + Math.sin(a) * (reach * 0.3 + reach * 0.7 * t) + drop)
      }
      ctx.stroke()
    }
    noGlow(ctx)
  }
  ctx.globalAlpha = 1
}

/**
 * 夜空 + 星点 + 全部事件（rising/blooming/done 显式三分支：done 不画）。
 * @param ctx - 画布上下文。
 * @param view - 本帧视图。
 */
function drawSky(ctx: CanvasRenderingContext2D, view: SceneView): void {
  ctx.fillStyle = 'rgba(10,10,18,0.6)'
  roundRectPath(ctx, SKY.x, SKY.y, SKY.w, SKY.h, 14)
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  const time = view.state.time
  const stars = starsForLevel(view.level.index)
  for (const s of stars) {
    const tw = 0.5 + 0.5 * Math.sin((time / 10) * 0.8 + s.phase * Math.PI * 2)
    ctx.globalAlpha = 0.25 + tw * 0.45
    ctx.fillStyle = '#e2e2ee'
    ctx.beginPath()
    ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  const events = view.state.result?.events ?? []
  for (const e of events) {
    const phase = eventPhase(e, time)
    if (phase === 'rising') {
      const span = e.burst - e.launch
      const progress = span > 0 ? Math.min(1, Math.max(0, (time - e.launch) / span)) : 1
      drawRising(ctx, view.level, e, progress)
    } else if (phase === 'blooming') {
      const c = burstCenter(view.level, e)
      const progress = (time - e.burst) / (e.end - e.burst)
      drawBloom(ctx, e, c.x, c.y, progress)
    }
    // done：已熄灭，不画。
  }
}

/**
 * 发射位卡片排：配方名 + 延时，选中高亮，风关奇数位挂「风+1s」角标。
 * @param ctx - 画布上下文。
 * @param view - 本帧视图。
 */
function drawPads(ctx: CanvasRenderingContext2D, view: SceneView): void {
  const state = view.state
  for (let i = 0; i < view.level.pads; i += 1) {
    const r = padRect(view.level.pads, i)
    const selected = state.selectedPad === i
    ctx.fillStyle = selected ? 'rgba(122,162,247,0.18)' : THEME.panel
    roundRectPath(ctx, r.x, r.y, r.w, r.h, 8)
    ctx.fill()
    ctx.strokeStyle = selected ? accent(0) : THEME.panelEdge
    ctx.lineWidth = selected ? 2 : 1
    ctx.stroke()
    ctx.lineWidth = 1
    ctx.textAlign = 'center'
    const a: Assignment | null = state.assignments[i] ?? null
    const recipe = a === null ? null : RECIPES.find((x) => x.id === a.recipe) ?? null
    ctx.font = '600 13px system-ui, sans-serif'
    ctx.fillStyle = recipe === null ? THEME.textMuted : recipe.color
    ctx.fillText(recipe === null ? '选配方' : recipe.name, r.x + r.w / 2, r.y + 20)
    ctx.font = '600 12px system-ui, sans-serif'
    ctx.fillStyle = THEME.textMuted
    ctx.fillText(a === null ? '--' : '延时' + a.delay + 's', r.x + r.w / 2, r.y + 38)
    if (view.level.wind && i % 2 === 1) {
      ctx.font = '600 10px system-ui, sans-serif'
      ctx.fillStyle = accent(4)
      ctx.fillText('风+1s', r.x + r.w / 2, r.y + 10)
    }
  }
}

/**
 * 右栏目标谱清单：每项一行 + 三态标记（pending 空心圆 / hit 绿勾 /
 * miss 红叉——显式三分支）。行高 30px，最多 5 项全在面板内。
 * @param ctx - 画布上下文。
 * @param view - 本帧视图。
 */
function drawSpectrum(ctx: CanvasRenderingContext2D, view: SceneView): void {
  ctx.fillStyle = THEME.panel
  roundRectPath(ctx, SPECTRUM_PANEL.x, SPECTRUM_PANEL.y, SPECTRUM_PANEL.w, SPECTRUM_PANEL.h, 12)
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.textAlign = 'left'
  ctx.font = '600 14px system-ui, sans-serif'
  ctx.fillStyle = THEME.text
  ctx.fillText('目标谱', SPECTRUM_PANEL.x + 14, SPECTRUM_PANEL.y + 26)
  ctx.font = '600 13px system-ui, sans-serif'
  view.level.items.forEach((item, i) => {
    const y = SPECTRUM_PANEL.y + 58 + i * 34
    const st = view.itemStates[i] ?? 'pending'
    ctx.textAlign = 'center'
    if (st === 'hit') {
      ctx.fillStyle = THEME.good
      ctx.fillText('✓', SPECTRUM_PANEL.x + 22, y + 4)
    } else if (st === 'miss') {
      ctx.fillStyle = THEME.bad
      ctx.fillText('✗', SPECTRUM_PANEL.x + 22, y + 4)
    } else {
      ctx.strokeStyle = THEME.textMuted
      ctx.beginPath()
      ctx.arc(SPECTRUM_PANEL.x + 22, y - 1, 6, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.textAlign = 'left'
    ctx.fillStyle = st === 'hit' ? THEME.text : st === 'miss' ? THEME.bad : THEME.textMuted
    ctx.fillText(describeItem(item), SPECTRUM_PANEL.x + 40, y + 4)
  })
  if (view.level.wind) {
    ctx.font = '600 12px system-ui, sans-serif'
    ctx.fillStyle = accent(4)
    ctx.fillText('风关：奇数位 +1s 升空', SPECTRUM_PANEL.x + 14, SPECTRUM_PANEL.y + SPECTRUM_PANEL.h - 14)
  }
}

/**
 * 右栏装配编辑器：配方 3x3 按钮网格（选中描亮色边）+ 延时滑条。
 * setup 且选中发射位时可用，否则整栏显示引导文案。
 * @param ctx - 画布上下文。
 * @param view - 本帧视图。
 */
function drawEditor(ctx: CanvasRenderingContext2D, view: SceneView): void {
  ctx.fillStyle = THEME.panel
  roundRectPath(ctx, EDITOR_PANEL.x, EDITOR_PANEL.y, EDITOR_PANEL.w, EDITOR_PANEL.h, 12)
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  const state = view.state
  const active = state.phase === 'setup' && state.selectedPad !== null
  ctx.textAlign = 'left'
  ctx.font = '600 14px system-ui, sans-serif'
  ctx.fillStyle = THEME.text
  ctx.fillText(active ? '发射位 ' + ((state.selectedPad ?? 0) + 1) : '装配台', EDITOR_PANEL.x + 14, EDITOR_PANEL.y + 26)
  if (!active) {
    ctx.font = '600 13px system-ui, sans-serif'
    ctx.fillStyle = THEME.textMuted
    ctx.fillText(state.phase === 'setup' ? '点击下方发射位开始装配' : '燃放中——等待结算', EDITOR_PANEL.x + 14, EDITOR_PANEL.y + 60)
    return
  }
  const pad = state.selectedPad ?? 0
  const current = state.assignments[pad]
  RECIPES.forEach((recipe, i) => {
    const r = recipeBtnRect(i)
    const on = current?.recipe === recipe.id
    ctx.fillStyle = on ? 'rgba(226,226,238,0.10)' : 'rgba(30,30,42,0.9)'
    roundRectPath(ctx, r.x, r.y, r.w, r.h, 6)
    ctx.fill()
    ctx.strokeStyle = on ? recipe.color : THEME.panelEdge
    ctx.lineWidth = on ? 2 : 1
    ctx.stroke()
    ctx.lineWidth = 1
    ctx.textAlign = 'center'
    ctx.font = '600 12px system-ui, sans-serif'
    ctx.fillStyle = on ? recipe.color : THEME.textMuted
    ctx.fillText(recipe.name, r.x + r.w / 2, r.y + 14)
    ctx.font = '600 10px system-ui, sans-serif'
    ctx.fillText(recipe.rise / 10 + 's/' + recipe.height, r.x + r.w / 2, r.y + 25)
  })
  // 延时滑条：轨道 + 6 档刻度 + 拖点 + 当前值（右锚定宽防错位）。
  const delay = current?.delay ?? 0
  ctx.textAlign = 'left'
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('引信延时', SLIDER.x - 6, SLIDER.y - 10)
  ctx.textAlign = 'right'
  ctx.fillStyle = THEME.text
  ctx.fillText(delay + 's', SLIDER.x + SLIDER.w + 6, SLIDER.y - 10)
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(SLIDER.x, SLIDER.y + SLIDER.h / 2)
  ctx.lineTo(SLIDER.x + SLIDER.w, SLIDER.y + SLIDER.h / 2)
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.strokeStyle = THEME.textMuted
  ctx.fillStyle = THEME.textMuted
  ctx.font = '600 10px system-ui, sans-serif'
  ctx.textAlign = 'center'
  for (let d = 0; d <= 5; d += 1) {
    const tx = SLIDER.x + (d / 5) * SLIDER.w
    ctx.beginPath()
    ctx.moveTo(tx, SLIDER.y - 2)
    ctx.lineTo(tx, SLIDER.y + 6)
    ctx.stroke()
    ctx.fillText(String(d), tx, SLIDER.y + 20)
  }
  const knobX = SLIDER.x + (delay / 5) * SLIDER.w
  ctx.fillStyle = accent(0)
  glow(ctx, accent(0), 8)
  ctx.beginPath()
  ctx.arc(knobX, SLIDER.y + SLIDER.h / 2, 7, 0, Math.PI * 2)
  ctx.fill()
  noGlow(ctx)
}

/**
 * 整帧绘制：背景 + HUD + 夜空 + 发射位排 + 点火按钮 + 底提示 + 右栏
 * 目标谱/编辑器 + 说明按钮 + 帮助面板（末尾最上层）。overlay 由 index
 * 层随后叠加。
 * @param ctx - 画布上下文。
 * @param view - 本帧视图。
 * @param helpOpen - 说明面板是否打开。
 */
export function renderScene(ctx: CanvasRenderingContext2D, view: SceneView, helpOpen = false): void {
  drawBackground(ctx, LOGICAL_W, LOGICAL_H)

  // HUD 行（基线 y=26）：左关卡 x16、中状态 x233、右数值 x704 右锚。
  hudPair(ctx, 16, 26, '关卡', view.hudLevel)
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = THEME.textMuted
  const phaseText = view.state.phase === 'setup' ? '阶段：装配引信' : view.state.phase === 'running' ? '阶段：燃放中' : '阶段：结算'
  ctx.fillText(phaseText, 233, 26)
  hudPair(ctx, 704, 26, view.hudRightLabel, view.hudRight, 'right')

  drawSky(ctx, view)
  drawPads(ctx, view)

  // 点火按钮（setup 可用亮起；running 灰置）。文本锚点 (71, 461) 与
  // 底提示 (233, 496) 净距 ≥160px。
  const canIgnite = view.state.phase === 'setup' && view.state.assignments.every((a: Assignment | null) => a !== null)
  ctx.fillStyle = canIgnite ? 'rgba(247,118,142,0.22)' : THEME.panel
  roundRectPath(ctx, IGNITE_BTN.x, IGNITE_BTN.y, IGNITE_BTN.w, IGNITE_BTN.h, 8)
  ctx.fill()
  ctx.strokeStyle = canIgnite ? THEME.bad : THEME.panelEdge
  ctx.lineWidth = canIgnite ? 2 : 1
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.textAlign = 'center'
  ctx.font = 'bold 14px system-ui, sans-serif'
  ctx.fillStyle = canIgnite ? THEME.bad : THEME.textMuted
  ctx.fillText('点火', IGNITE_BTN.x + IGNITE_BTN.w / 2, IGNITE_BTN.y + 18)

  // 底部提示带（单行，居中于左栏）。与说明按钮文本同带净距 ≥400px。
  ctx.textAlign = 'center'
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('点击发射位选配方 · 拖滑条设延时 · 空格点火 · R 重开 · P 暂停', 233, 500)

  drawSpectrum(ctx, view)
  drawEditor(ctx, view)

  // 说明按钮（60x24，任何阶段可点，画在渲染末尾最上层）。
  const hb = HELP_BTN
  ctx.fillStyle = THEME.panel
  roundRectPath(ctx, hb.x, hb.y, hb.w, hb.h, 8)
  ctx.fill()
  ctx.strokeStyle = helpOpen ? accent(2) : THEME.panelEdge
  ctx.lineWidth = helpOpen ? 2 : 1
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.textAlign = 'center'
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.fillStyle = helpOpen ? accent(2) : THEME.textMuted
  ctx.fillText('说明', hb.x + hb.w / 2, hb.y + 16)

  // 帮助面板（最上层，仅 helpOpen 时）。
  if (helpOpen) {
    ctx.fillStyle = 'rgba(13,13,20,0.92)'
    roundRectPath(ctx, HELP_PANEL.x, HELP_PANEL.y, HELP_PANEL.w, HELP_PANEL.h, 10)
    ctx.fill()
    ctx.strokeStyle = THEME.panelEdge
    ctx.stroke()
    ctx.textAlign = 'left'
    ctx.font = '600 15px system-ui, sans-serif'
    HELP_LINES.forEach((line, i) => {
      ctx.fillStyle = i === 0 ? accent(2) : THEME.text
      ctx.fillText(line, HELP_PANEL.x + 14, HELP_PANEL.y + 26 + i * 22)
    })
  }
}
