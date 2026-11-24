/**
 * 时间线 Timeline 渲染层：横向卷轴时间轴（锚点旗标）、领域色边手牌卡、
 * 选中/拖拽时的插入位高亮、提交判定动画（锁定绿勾 + 错误红框回手提示）、
 * HUD（关卡/得分/错误/限时）、说明按钮与帮助面板（渲染函数末尾最上层，
 * 任意阶段与暂停态均可开合）、过关/超时/暂停 overlay。命中检测函数与
 * 绘制共用同一套布局矩形。所有动态文本右锚或居中，字号定宽防错位。
 */
import { THEME, accent, drawBackground, drawOverlay, glow, hudPair, noGlow, roundRectPath, spaced, type ParticleSystem } from '../theme.ts'
import type { Hint, TimelineEvent, TimelineState } from './logic.ts'

export const LOGICAL_W = 900
export const LOGICAL_H = 560

/** 时间轴面板（卷轴带）矩形常量。 */
const PANEL_X = 16
const PANEL_Y = 44
const PANEL_W = LOGICAL_W - 32
const PANEL_H = 190
/** 已放置卡尺寸与插位间距（随卡数整体居中，自适应 1..7 张）。 */
const PLACED_W = 100
const PLACED_H = 80
const PLACED_TOP = 76
const SLOT_PITCH = 108
const AXIS_Y = 168
/** 手牌两行网格。 */
const HAND_W = 128
const HAND_H = 88
const HAND_TOP1 = 324
const HAND_TOP2 = 424
const HAND_LEFT = 20
const HAND_PITCH = 140
const HAND_PER_ROW = 6

/** 提交按钮矩形（手牌区上方右侧）。 */
export const SUBMIT_RECT = { x: LOGICAL_W - 16 - 96, y: 280, w: 96, h: 30 } as const
/** 说明按钮矩形（画布右上角，渲染最上层）。 */
export const HELP_RECT = { x: LOGICAL_W - 16 - 60, y: 12, w: 60, h: 24 } as const

/** 渲染层需要的交互/动效快照（由 index 维护）。 */
export interface TimelineUi {
  selectedHandId: number | null
  drag: { id: number; x: number; y: number } | null
  hoverSlot: number | null
  /** 最近一次判定锁定/错误的卡 id（闪显动画用）。 */
  flashLockedIds: number[]
  flashWrongIds: number[]
  /** 最近一次判定距今的毫秒数。 */
  flashAgeMs: number
  paused: boolean
  helpOpen: boolean
  /** 5 关全部通关。 */
  finished: boolean
  totalScore: number
}

/** 时间轴上第 slot 个插入位的 x 中心（含居中边距，随卡数自适应）。 */
export function slotCenterX(state: TimelineState, slot: number): number {
  const k = state.timeline.length
  const total = k * PLACED_W + (k - 1) * (SLOT_PITCH - PLACED_W)
  const baseX = PANEL_X + (PANEL_W - total) / 2
  return baseX + slot * SLOT_PITCH - (SLOT_PITCH - PLACED_W) / 2
}

/** 时间轴上第 i 张已放置卡的矩形。 */
export function placedRect(state: TimelineState, i: number): { x: number; y: number; w: number; h: number } {
  return { x: slotCenterX(state, i), y: PLACED_TOP, w: PLACED_W, h: PLACED_H }
}

/** 手牌第 i 张卡的矩形（两行网格，行内间距充足）。 */
export function handRect(i: number): { x: number; y: number; w: number; h: number } {
  const row = Math.floor(i / HAND_PER_ROW)
  const col = i % HAND_PER_ROW
  return { x: HAND_LEFT + col * HAND_PITCH, y: row === 0 ? HAND_TOP1 : HAND_TOP2, w: HAND_W, h: HAND_H }
}

/** 命中时间轴带内的插入位（0..k），不在带内或离所有空位都太远返回 null。 */
export function slotAt(x: number, y: number, state: TimelineState): number | null {
  if (y < PANEL_Y + 8 || y > PANEL_Y + PANEL_H - 40) return null
  if (x < PANEL_X || x > PANEL_X + PANEL_W) return null
  const k = state.timeline.length
  let best = -1
  let bestDist = SLOT_PITCH / 2 + 8
  for (let s = 0; s <= k; s += 1) {
    const d = Math.abs(x - slotCenterX(state, s))
    if (d < bestDist) {
      bestDist = d
      best = s
    }
  }
  return best >= 0 ? best : null
}

/** 命中一张已放置卡（不含插入空隙）。 */
export function placedAt(x: number, y: number, state: TimelineState): number | null {
  for (let i = 0; i < state.timeline.length; i += 1) {
    const r = placedRect(state, i)
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i
  }
  return null
}

/** 命中一张手牌。 */
export function handAt(x: number, y: number, state: TimelineState): number | null {
  for (let i = 0; i < state.hand.length; i += 1) {
    const r = handRect(i)
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i
  }
  return null
}

/** 点是否落在按钮矩形内。 */
export function inRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
}

const CATEGORY_ACCENT: Record<string, number> = { tech: 0, history: 1, culture: 2 }
const CATEGORY_NAME: Record<string, string> = { tech: '科技', history: '历史', culture: '文化' }

/** 年份显示：公元前为负数（-221 → 前221）。 */
function yearText(year: number): string {
  return year < 0 ? '前' + -year : String(year)
}

/** 居中绘制名称，超长时按字数折两行（中文按 12px 等宽估算）。 */
function drawName(ctx: CanvasRenderingContext2D, name: string, cx: number, topY: number, maxChars: number, fontPx: number, color: string): void {
  ctx.font = '600 ' + fontPx + 'px system-ui, sans-serif'
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  const chars = [...name]
  if (chars.length <= maxChars) {
    ctx.fillText(name, cx, topY)
    return
  }
  const half = Math.ceil(chars.length / 2)
  ctx.fillText(chars.slice(0, half).join(''), cx, topY)
  ctx.fillText(chars.slice(half).join(''), cx, topY + fontPx + 4)
}

/** 一张事件卡主体：领域色描边 + 名称 + 领域 +（可选）年份与状态角标。 */
function drawCard(
  ctx: CanvasRenderingContext2D, card: TimelineEvent, r: { x: number; y: number; w: number; h: number },
  opts: { selected: boolean; showYear: boolean; lockFlash: boolean; wrongFlash: boolean },
): void {
  const color = accent(CATEGORY_ACCENT[card.category] ?? 0)
  ctx.fillStyle = THEME.panel
  glow(ctx, opts.selected || opts.wrongFlash ? color : THEME.panelEdge, opts.selected ? 12 : 8)
  roundRectPath(ctx, r.x, r.y, r.w, r.h, 9)
  ctx.fill()
  noGlow(ctx)
  ctx.strokeStyle = opts.wrongFlash ? THEME.bad : color
  ctx.lineWidth = opts.selected ? 2.5 : 1.5
  roundRectPath(ctx, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 9)
  ctx.stroke()
  drawName(ctx, card.name, r.x + r.w / 2, r.y + 30, Math.floor((r.w - 10) / 12), 12, THEME.text)
  ctx.font = '600 11px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText(CATEGORY_NAME[card.category] ?? '', r.x + r.w / 2, r.y + r.h - 22)
  ctx.font = '700 13px system-ui, sans-serif'
  ctx.fillStyle = opts.showYear ? THEME.gold : THEME.textMuted
  ctx.fillText(opts.showYear ? yearText(card.year) : '· · ·', r.x + r.w / 2, r.y + r.h - 7)
  if (opts.lockFlash) {
    ctx.strokeStyle = THEME.good
    ctx.lineWidth = 3
    roundRectPath(ctx, r.x + 2, r.y + 2, r.w - 4, r.h - 4, 8)
    ctx.stroke()
    ctx.fillStyle = THEME.good
    ctx.font = 'bold 15px system-ui, sans-serif'
    ctx.fillText('✓', r.x + r.w - 14, r.y + 18)
  }
  if (opts.wrongFlash) {
    ctx.fillStyle = THEME.bad
    ctx.font = 'bold 15px system-ui, sans-serif'
    ctx.fillText('✕', r.x + r.w - 14, r.y + 18)
  }
}

/** 提示文本行（两行以内，15px，画在时间轴面板底部）。 */
function drawHints(ctx: CanvasRenderingContext2D, hints: Hint[]): void {
  if (hints.length === 0) return
  const parts = hints.map((h) => '「' + h.card.name + '」应比「' + h.ref.name + '」（' + yearText(h.ref.year) + '）更' + (h.direction === 'earlier' ? '早' : '晚'))
  const out: string[] = []
  let cur = ''
  for (const p of parts) {
    if (cur.length > 0 && cur.length + p.length > 44) {
      out.push(cur)
      cur = p
    } else {
      cur = cur.length > 0 ? cur + '；' + p : p
    }
  }
  if (cur.length > 0) out.push(cur)
  ctx.font = '600 15px system-ui, sans-serif'
  ctx.textAlign = 'center'
  for (let i = 0; i < Math.min(out.length, 2); i += 1) {
    ctx.fillStyle = i === 0 ? THEME.bad : THEME.textMuted
    ctx.fillText(out[i]!, PANEL_X + PANEL_W / 2, 196 + i * 22)
  }
}

/** 帮助面板正文（8 行完整规则 + 易误解点，15px 大字）。 */
const HELP_LINES = [
  '· 目标：把手中事件卡按发生年份先后排上时间轴（左早右晚）。',
  '· 锚点卡已放好（旗标标记）；其余卡点击选中后点时间轴空位插入，',
  '　 也可直接拖拽到目标位置；已放置的卡可以再点击交换或收回。',
  '· 全部放完后按 Enter 或点「提交」逐张判定：相对邻居正确 → 锁定，',
  '　 错误 → 回到手牌并提示应比某张锁定卡更早还是更晚。',
  '· 每错一张扣 10 分（本关 100 分起、20 分保底）；关卡递进：',
  '　 卡片更多（5→7）、后期同领域相邻年代干扰更强且开始限时。',
  '· 注意：年份相同视为顺序正确；锚点永远锁定；R 重开本关同题重打。',
]

/** 主渲染入口：场景 → 粒子 → 阶段 overlay → 说明按钮/帮助面板（最上层）。 */
export function renderTimeline(
  ctx: CanvasRenderingContext2D, w: number, h: number, state: TimelineState, ui: TimelineUi,
  particles: ParticleSystem,
): void {
  ctx.clearRect(0, 0, w, h)
  drawBackground(ctx, w, h)

  // HUD：左起关卡、得分；右侧错误、限时（动态数字右锚防溢出）。
  hudPair(ctx, 16, 22, '关卡 ', state.level + '/5')
  hudPair(ctx, 150, 22, '得分 ', String(ui.totalScore), 'left', THEME.gold)
  hudPair(ctx, w - 230, 22, '错误 ', String(state.errors), 'right', state.errors > 0 ? THEME.bad : THEME.text)
  const timeText = state.remainingSec > 0 ? Math.ceil(state.remainingSec) + 's' : '不限'
  hudPair(ctx, w - 100, 22, '时间 ', timeText, 'right', state.remainingSec > 0 && state.remainingSec <= 10 ? THEME.bad : THEME.text)

  // 卷轴时间轴面板 + 轴线。
  ctx.fillStyle = THEME.panel
  roundRectPath(ctx, PANEL_X, PANEL_Y, PANEL_W, PANEL_H, 12)
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  roundRectPath(ctx, PANEL_X + 0.5, PANEL_Y + 0.5, PANEL_W - 1, PANEL_H - 1, 12)
  ctx.stroke()
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(PANEL_X + 12, AXIS_Y)
  ctx.lineTo(PANEL_X + PANEL_W - 12, AXIS_Y)
  ctx.stroke()

  // 插入位高亮（选中或拖拽手牌时）。
  const picking = ui.drag !== null || ui.selectedHandId !== null
  if (picking && state.phase === 'playing') {
    for (let s = 0; s <= state.timeline.length; s += 1) {
      const cx = slotCenterX(state, s)
      const hot = ui.hoverSlot === s
      ctx.fillStyle = hot ? THEME.gold : 'rgba(234,180,103,0.25)'
      glow(ctx, THEME.gold, hot ? 10 : 3)
      roundRectPath(ctx, cx - 5, PLACED_TOP + 4, 10, PLACED_H - 8, 4)
      ctx.fill()
      noGlow(ctx)
    }
  }

  // 已放置卡 + 锚点旗标；锁定卡在判定动画期间亮绿勾并揭示年份。
  const flashOn = ui.flashAgeMs < 1200
  for (let i = 0; i < state.timeline.length; i += 1) {
    const card = state.timeline[i]!
    const r = placedRect(state, i)
    const revealed = state.phase !== 'playing' || (flashOn && ui.flashLockedIds.includes(card.id))
    drawCard(ctx, card, r, {
      selected: false,
      showYear: revealed,
      lockFlash: flashOn && ui.flashLockedIds.includes(card.id),
      wrongFlash: flashOn && ui.flashWrongIds.includes(card.id),
    })
    if (card.id === state.round.anchor.id) {
      ctx.fillStyle = THEME.gold
      ctx.beginPath()
      ctx.moveTo(r.x + 14, PLACED_TOP - 4)
      ctx.lineTo(r.x + 30, PLACED_TOP + 2)
      ctx.lineTo(r.x + 14, PLACED_TOP + 8)
      ctx.closePath()
      ctx.fill()
      ctx.font = '700 11px system-ui, sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText('锚点', r.x + 34, PLACED_TOP + 6)
    }
  }

  if (ui.flashAgeMs < 2600 && state.hints.length > 0) drawHints(ctx, state.hints)

  // 手牌区标签与提交按钮。
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText(state.hand.length > 0 ? '手牌 · 点击选中后点时间轴空位插入（可拖拽）' : '手牌已空 · Enter 或「提交」判定', 20, 300)
  const submitOk = state.phase === 'playing' && state.hand.length === 0
  ctx.fillStyle = submitOk ? THEME.good : THEME.panel
  glow(ctx, submitOk ? THEME.good : THEME.panelEdge, submitOk ? 10 : 4)
  roundRectPath(ctx, SUBMIT_RECT.x, SUBMIT_RECT.y, SUBMIT_RECT.w, SUBMIT_RECT.h, 7)
  ctx.fill()
  noGlow(ctx)
  ctx.fillStyle = submitOk ? '#10101a' : THEME.textMuted
  ctx.font = '700 14px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('提交 (Enter)', SUBMIT_RECT.x + SUBMIT_RECT.w / 2, SUBMIT_RECT.y + 20)

  // 手牌卡（最近判定错误的卡同步红框标示）。
  for (let i = 0; i < state.hand.length; i += 1) {
    const card = state.hand[i]!
    drawCard(ctx, card, handRect(i), {
      selected: ui.selectedHandId === card.id,
      showYear: false,
      lockFlash: false,
      wrongFlash: flashOn && ui.flashWrongIds.includes(card.id),
    })
  }

  // 拖拽幽灵卡：跟随指针，画在场景之上、overlay 之下。
  if (ui.drag !== null) {
    const d = ui.drag
    const card = state.hand.find((c) => c.id === d.id) ?? state.timeline.find((c) => c.id === d.id)
    if (card !== undefined) {
      ctx.globalAlpha = 0.85
      drawCard(ctx, card, { x: d.x - HAND_W / 2, y: d.y - HAND_H / 2, w: HAND_W, h: HAND_H }, { selected: true, showYear: false, lockFlash: false, wrongFlash: false })
      ctx.globalAlpha = 1
    }
  }

  particles.tick(ctx, 16)

  // 阶段 overlay（帮助面板之前，帮助可开合于其上）。
  if (ui.finished) {
    drawOverlay(ctx, w, h, '全部通关', '总分 ' + ui.totalScore + ' · Enter 再来一局', THEME.gold)
  } else if (state.phase === 'cleared') {
    drawOverlay(ctx, w, h, '过关', '本关得分 ' + Math.max(20, 100 - state.errors * 10) + ' · Enter 下一关', THEME.good)
  } else if (state.phase === 'timeout') {
    drawOverlay(ctx, w, h, '时间到', 'R 重开本关（同题）', THEME.bad)
  } else if (ui.paused) {
    drawOverlay(ctx, w, h, '已暂停', 'P 继续 · ？查看说明', THEME.text)
  }

  // —— 渲染函数末尾：说明按钮 + 帮助面板，永远最上层，任意阶段可开合 ——
  if (ui.helpOpen) {
    const pw = 660
    const ph = 372
    const px = (w - pw) / 2
    const py = (h - ph) / 2
    ctx.fillStyle = 'rgba(13,13,20,0.55)'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = THEME.panel
    glow(ctx, THEME.panelEdge, 14)
    roundRectPath(ctx, px, py, pw, ph, 14)
    ctx.fill()
    noGlow(ctx)
    ctx.strokeStyle = THEME.panelEdge
    ctx.lineWidth = 1
    roundRectPath(ctx, px + 0.5, py + 0.5, pw - 1, ph - 1, 14)
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.font = 'bold 18px system-ui, sans-serif'
    ctx.fillStyle = THEME.text
    ctx.fillText(spaced('玩法说明'), w / 2, py + 38)
    ctx.font = '600 15px system-ui, sans-serif'
    ctx.textAlign = 'left'
    for (let i = 0; i < HELP_LINES.length; i += 1) {
      ctx.fillStyle = i === 0 ? THEME.text : THEME.textMuted
      ctx.fillText(HELP_LINES[i]!, px + 34, py + 74 + i * 24)
    }
    ctx.textAlign = 'center'
    ctx.font = '600 13px system-ui, sans-serif'
    ctx.fillStyle = THEME.gold
    ctx.fillText('点击「关闭」或按 ？ / Esc 返回', w / 2, py + ph - 18)
  }
  ctx.fillStyle = THEME.panel
  glow(ctx, THEME.gold, 6)
  roundRectPath(ctx, HELP_RECT.x, HELP_RECT.y, HELP_RECT.w, HELP_RECT.h, 6)
  ctx.fill()
  noGlow(ctx)
  ctx.fillStyle = THEME.gold
  ctx.font = '700 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(ui.helpOpen ? '关闭' : '说明', HELP_RECT.x + HELP_RECT.w / 2, HELP_RECT.y + 17)
}

export { LOGICAL_W as TIMELINE_W, LOGICAL_H as TIMELINE_H }
