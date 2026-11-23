/**
 * 牛头王 TakeSix 渲染层：牌卡风格的四行牌列（牛头角标）、中段同时亮牌
 * 区、底部手牌扇形、罚分/局分 HUD；说明按钮与帮助面板画在渲染函数
 * 末尾（最上层，任何阶段/暂停可开合）。状态与动画进度由调用方持有，
 * 渲染器无状态。
 */
import { bullheads, HAND_SIZE, ROW_COUNT, ROUND_COUNT, rowHeads, type TakeSixState } from './logic.ts'
import { THEME, accent, drawBackground, drawOverlay, glow, hudPair, noGlow, roundRectPath } from '../theme.ts'

/** 逻辑画布尺寸。 */
export const W = 560
export const H = 430

/** HUD 基线与列位（左三列定 x，右列右锚——相邻列尾间隔均 ≥ 50px）。 */
const HUD_Y = 21
const HUD_ROUND_X = 10
const HUD_TURN_X = 95
const HUD_SCORE_X = 205
const HUD_PENALTY_RIGHT = 430

/** 说明按钮（右上角 60x24；HUD 右列止于 430，与按钮间隔 58px）。 */
export const HELP_BTN = { x: W - 72, y: 6, w: 60, h: 24 }

/** 帮助面板（顶部居中弹层，画在渲染函数末尾盖住棋盘）。 */
const HELP_PANEL = { x: 24, y: 56, w: W - 48, h: 260 }
/** 帮助面板文案（16px 大字，首行为标题色）。 */
const HELP_LINES = [
  '牛头王 · 玩法速览',
  '每回合双方各出一张暗牌同时翻开，牌面小的先放。',
  '牌放入行尾小于它且最接近的行；行已有 5 张再放入即收走整行。',
  '若你的牌比所有行尾都小，须自选一行收走，该牌单独开新行。',
  '牛头计罚：多数牌 1 头，5 的倍数 2 头，10 的倍数 3 头。',
  '双同数（11/22/…）5 头，55 最多 7 头；收行按整行牛头累计。',
  '10 回合后本局罚分少者胜；三局积分定总冠军。',
  '点击手牌出牌 · 空格开下一局 · P 暂停 · R 重开新比赛',
]

/** 行牌列区域。 */
const ROW_X = 16
const ROW_Y = 48
const ROW_DY = 44
const ROW_CARD_W = 44
const ROW_CARD_H = 28
const ROW_CARD_GAP = 6
/** 行牛头合计标签的 x（行牌最右 310，留 14px 间距）。 */
const ROW_HEADS_X = 324

/** 中段亮牌区两张牌的矩形与 AI 手牌数文本。 */
const REVEAL_YOU = { x: 204, y: 222, w: 56, h: 40 }
const REVEAL_AI = { x: 300, y: 222, w: 56, h: 40 }
const AI_COUNT_RIGHT = W - 16
const AI_COUNT_Y = 243
/** chooseRow 提示行基线（亮牌区下方、手牌区上方）。 */
const PROMPT_Y = 282

/** 手牌扇形区域。 */
const HAND_Y = 296
const HAND_CARD_W = 46
const HAND_CARD_H = 62
const HAND_GAP = 6
/** 手牌下方提示基线。 */
const HAND_HINT_Y = 384

/** 局间结算面板与下一局按钮。 */
const ROUND_PANEL = { x: 130, y: 140, w: 300, h: 120 }
const NEXT_RECT = { x: 175, y: 205, w: 210, h: 36 }

/** 渲染视图：状态 + 动画/交互标志（全部由 index 持有）。 */
export interface TakeSixView {
  state: TakeSixState
  /** 亮牌动画进度 0..1（1 = 完全亮出）。 */
  reveal: number
  paused: boolean
  helpOpen: boolean
  /** 悬停抬升的手牌下标，或 null。 */
  hover: number | null
}

/** 点击区域：说明按钮 / 手牌 / 收行选择的行 / 下一局按钮。 */
export type TakeSixHit =
  | { kind: 'help' }
  | { kind: 'hand'; index: number }
  | { kind: 'row'; row: number }
  | { kind: 'next' }

/** 手牌第 index 张的矩形（扇形：中间高、两端下垂 10px）。 */
export function handCardRect(n: number, index: number): { x: number; y: number; w: number; h: number } {
  const total = n * HAND_CARD_W + (n - 1) * HAND_GAP
  const x0 = (W - total) / 2
  const mid = (n - 1) / 2
  const dy = mid > 0 ? Math.round((10 * (index - mid) * (index - mid)) / (mid * mid)) : 0
  return { x: x0 + index * (HAND_CARD_W + HAND_GAP), y: HAND_Y + dy, w: HAND_CARD_W, h: HAND_CARD_H }
}

/** 收行动画的粒子迸发点（第 row 行牌列中心）。 */
export function rowBurstPos(row: number): { x: number; y: number } {
  return { x: ROW_X + 150, y: ROW_Y + row * ROW_DY + ROW_CARD_H / 2 }
}

/** 牛头角标颜色：头越多越红。 */
function headColor(heads: number): string {
  if (heads >= 7) return '#f0005c'
  if (heads >= 5) return THEME.bad
  if (heads >= 3) return '#ff9e64'
  if (heads >= 2) return THEME.gold
  return THEME.textMuted
}

/**
 * 画一张牌面卡：浅底、深字、右上牛头角标（1 头不画角标）。
 * @param ctx - 画布上下文。
 * @param r - 卡矩形。
 * @param value - 牌面数字。
 * @param opts - 边框/压暗/透明度选项。
 */
function drawCard(
  ctx: CanvasRenderingContext2D,
  r: { x: number; y: number; w: number; h: number },
  value: number,
  opts: { border?: string; dim?: boolean; alpha?: number } = {},
): void {
  const heads = bullheads(value)
  ctx.globalAlpha = opts.alpha ?? 1
  ctx.fillStyle = opts.dim ? '#c9c9d6' : '#ececf4'
  roundRectPath(ctx, r.x, r.y, r.w, r.h, 5)
  ctx.fill()
  ctx.strokeStyle = opts.border ?? 'rgba(13,13,20,0.35)'
  ctx.lineWidth = opts.border !== undefined ? 2 : 1
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#1a1a24'
  ctx.font = (r.h >= 50 ? 'bold 18px' : r.h >= 36 ? 'bold 17px' : 'bold 13px') + ' system-ui, sans-serif'
  ctx.fillText(String(value), r.x + r.w / 2, r.y + r.h / 2 + 1)
  if (heads > 1) {
    const color = headColor(heads)
    ctx.fillStyle = color
    ctx.font = 'bold 9px system-ui, sans-serif'
    const label = '牛' + heads
    const tw = ctx.measureText(label).width
    roundRectPath(ctx, r.x + r.w - tw - 6, r.y + 2, tw + 4, 11, 5)
    ctx.fill()
    ctx.fillStyle = '#14141c'
    ctx.fillText(label, r.x + r.w - 4 - tw / 2, r.y + 8)
  }
  ctx.globalAlpha = 1
}

/** 画 4 行牌列 + 每行牛头合计；chooseRow 阶段可选行金色高亮。 */
function drawRows(ctx: CanvasRenderingContext2D, s: TakeSixState, choosing: boolean): void {
  for (let r = 0; r < ROW_COUNT; r += 1) {
    const y = ROW_Y + r * ROW_DY
    const row = s.rows[r]!
    if (choosing) {
      ctx.fillStyle = 'rgba(224,175,104,0.10)'
      roundRectPath(ctx, ROW_X - 6, y - 4, 6 * ROW_CARD_W + 5 * ROW_CARD_GAP + 12, ROW_CARD_H + 8, 8)
      ctx.fill()
      ctx.strokeStyle = THEME.gold
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.lineWidth = 1
    }
    for (let i = 0; i < row.length; i += 1) {
      drawCard(ctx, { x: ROW_X + i * (ROW_CARD_W + ROW_CARD_GAP), y, w: ROW_CARD_W, h: ROW_CARD_H }, row[i]!)
    }
    // 行牛头合计（固定列，文本右端随行数不越界：'88 牛' 最宽约 34px）。
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.font = '600 12px system-ui, sans-serif'
    const total = rowHeads(row)
    ctx.fillStyle = total >= 6 ? headColor(Math.min(7, Math.ceil(total / 3))) : THEME.textMuted
    ctx.fillText(total + ' 牛', ROW_HEADS_X, y + ROW_CARD_H / 2 + 4)
  }
}

/** 画中段亮牌区：双方本回合所出的牌（翻开动画 alpha/scale）。 */
function drawReveal(ctx: CanvasRenderingContext2D, s: TakeSixState, reveal: number): void {
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('你', REVEAL_YOU.x + REVEAL_YOU.w / 2, REVEAL_YOU.y - 6)
  ctx.fillText('AI', REVEAL_AI.x + REVEAL_AI.w / 2, REVEAL_AI.y - 6)
  const grow = 0.6 + 0.4 * reveal
  const place = (base: { x: number; y: number; w: number; h: number }, value: number, border: string): void => {
    const w = base.w * grow
    const h = base.h * grow
    drawCard(ctx, { x: base.x + (base.w - w) / 2, y: base.y + (base.h - h) / 2, w, h }, value, { border, alpha: reveal })
  }
  if (s.revealedYou !== null) place(REVEAL_YOU, s.revealedYou, accent(4))
  else {
    ctx.fillStyle = THEME.textMuted
    ctx.fillText('出牌后亮牌', REVEAL_YOU.x + REVEAL_YOU.w / 2, REVEAL_YOU.y + REVEAL_YOU.h / 2 + 4)
  }
  if (s.revealedAi !== null) place(REVEAL_AI, s.revealedAi, THEME.bad)
  // AI 剩余手牌数（右锚定，不会与亮牌区相交：亮牌区右缘 356）。
  ctx.textAlign = 'right'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('AI 手牌 ' + s.aiHand.length + ' 张', AI_COUNT_RIGHT, AI_COUNT_Y)
}

/** 画底部手牌扇形（悬停抬升 + 阶段态提示）。 */
function drawHand(ctx: CanvasRenderingContext2D, s: TakeSixState, hover: number | null, active: boolean): void {
  const n = s.yourHand.length
  if (n === 0) return
  for (let i = 0; i < n; i += 1) {
    const r = handCardRect(n, i)
    const lifted = hover === i
    const rect = { x: r.x, y: r.y - (lifted ? 10 : 0), w: r.w, h: r.h }
    if (active) {
      const color = accent(i % 8)
      glow(ctx, color, lifted ? 16 : 6)
      drawCard(ctx, rect, s.yourHand[i]!, { border: lifted ? color : undefined })
      noGlow(ctx)
    } else {
      drawCard(ctx, rect, s.yourHand[i]!, { dim: true })
    }
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText(active ? '点击一张手牌出牌（同时翻开，小牌先放）' : '等待本回合结算…', W / 2, HAND_HINT_Y)
}

/**
 * 画一帧完整画面（含暂停/结算/终局覆盖层；说明按钮与帮助面板在最末，
 * 任何阶段/暂停都保持在最上层）。
 * @param ctx - 画布上下文。
 * @param view - 渲染视图。
 */
export function renderTakeSix(ctx: CanvasRenderingContext2D, view: TakeSixView): void {
  const s = view.state
  ctx.clearRect(0, 0, W, H)
  ctx.textBaseline = 'alphabetic' // drawCard 会改成 middle，逐帧复位防串扰
  drawBackground(ctx, W, H)

  // HUD：局/回合/比分定列，罚分右锚（列间距见常量注释）。
  hudPair(ctx, HUD_ROUND_X, HUD_Y, '局 ', s.round + '/' + ROUND_COUNT)
  hudPair(ctx, HUD_TURN_X, HUD_Y, '回合 ', Math.min(s.turn + 1, HAND_SIZE) + '/' + HAND_SIZE)
  hudPair(ctx, HUD_SCORE_X, HUD_Y, '比分 ', s.roundWinsYou + ':' + s.roundWinsAi)
  hudPair(
    ctx, HUD_PENALTY_RIGHT, HUD_Y, '罚分 ',
    s.penaltyYou + ':' + s.penaltyAi, 'right',
    s.penaltyYou <= s.penaltyAi ? THEME.good : THEME.bad,
  )

  const choosing = s.phase === 'chooseRow'
  drawRows(ctx, s, choosing)
  drawReveal(ctx, s, view.reveal)
  if (choosing && s.pendingYouCard !== null) {
    ctx.textAlign = 'center'
    ctx.font = '600 13px system-ui, sans-serif'
    glow(ctx, THEME.gold, 8)
    ctx.fillStyle = THEME.gold
    ctx.fillText('你的 ' + s.pendingYouCard + ' 比所有行尾都小：点击收走一行', W / 2, PROMPT_Y)
    noGlow(ctx)
  }
  drawHand(ctx, s, view.hover, s.phase === 'pick')

  if (s.phase === 'roundOver') {
    ctx.fillStyle = 'rgba(13,13,20,0.86)'
    roundRectPath(ctx, ROUND_PANEL.x, ROUND_PANEL.y, ROUND_PANEL.w, ROUND_PANEL.h, 12)
    ctx.fill()
    ctx.strokeStyle = THEME.panelEdge
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.font = 'bold 20px system-ui, sans-serif'
    ctx.fillStyle = s.roundWinner === 'you' ? THEME.good : s.roundWinner === 'ai' ? THEME.bad : THEME.text
    ctx.fillText(
      s.roundWinner === 'you' ? '本局胜利' : s.roundWinner === 'ai' ? '本局失利' : '本局平分',
      W / 2, ROUND_PANEL.y + 34,
    )
    ctx.font = '600 13px system-ui, sans-serif'
    ctx.fillStyle = THEME.textMuted
    ctx.fillText(
      '罚分 ' + s.penaltyYou + ':' + s.penaltyAi + ' · 总比分 ' + s.roundWinsYou + ':' + s.roundWinsAi,
      W / 2, ROUND_PANEL.y + 58,
    )
    glow(ctx, accent(0), 10)
    ctx.fillStyle = accent(0)
    roundRectPath(ctx, NEXT_RECT.x, NEXT_RECT.y, NEXT_RECT.w, NEXT_RECT.h, 8)
    ctx.fill()
    noGlow(ctx)
    ctx.font = '600 15px system-ui, sans-serif'
    ctx.fillStyle = '#14141c'
    ctx.fillText('下一局（空格）', W / 2, NEXT_RECT.y + NEXT_RECT.h / 2 + 5)
  }
  if (s.phase === 'matchOver') {
    drawOverlay(
      ctx, W, H,
      s.matchWinner === 'you' ? '比赛胜利' : s.matchWinner === 'ai' ? '比赛失利' : '势均力敌',
      '总局分 ' + s.roundWinsYou + ':' + s.roundWinsAi + ' · 总罚分 ' + s.totalYou + ':' + s.totalAi + ' · 按 R 重开',
      s.matchWinner === 'you' ? THEME.gold : s.matchWinner === 'ai' ? THEME.bad : THEME.text,
    )
  } else if (view.paused) {
    drawOverlay(ctx, W, H, '已暂停', '按 P 继续 · R 重开')
  }

  // 说明按钮 + 帮助面板：渲染函数最末绘制，压住一切棋盘与覆盖层。
  const hb = HELP_BTN
  ctx.fillStyle = THEME.panel
  roundRectPath(ctx, hb.x, hb.y, hb.w, hb.h, 8)
  ctx.fill()
  ctx.strokeStyle = view.helpOpen ? accent(2) : THEME.panelEdge
  ctx.lineWidth = view.helpOpen ? 2 : 1
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.fillStyle = view.helpOpen ? accent(2) : THEME.textMuted
  ctx.fillText('说明', hb.x + hb.w / 2, hb.y + 17)
  if (view.helpOpen) {
    ctx.fillStyle = 'rgba(13,13,20,0.94)'
    roundRectPath(ctx, HELP_PANEL.x, HELP_PANEL.y, HELP_PANEL.w, HELP_PANEL.h, 10)
    ctx.fill()
    ctx.strokeStyle = THEME.panelEdge
    ctx.stroke()
    ctx.textAlign = 'left'
    ctx.font = '600 16px system-ui, sans-serif'
    HELP_LINES.forEach((line, i) => {
      ctx.fillStyle = i === 0 ? accent(2) : THEME.text
      ctx.fillText(line, HELP_PANEL.x + 16, HELP_PANEL.y + 30 + i * 26)
    })
  }
}

/**
 * 命中测试：说明按钮永远可点；手牌仅在 pick 阶段、行仅在 chooseRow
 * 阶段、下一局按钮仅在 roundOver 阶段返回。
 * @param x - 逻辑坐标 x。
 * @param y - 逻辑坐标 y。
 * @param view - 渲染视图（取 state.phase 与手牌数）。
 * @returns 命中区域或 null。
 */
export function hitTest(x: number, y: number, view: TakeSixView): TakeSixHit | null {
  const hb = HELP_BTN
  if (x >= hb.x && x <= hb.x + hb.w && y >= hb.y && y <= hb.y + hb.h) return { kind: 'help' }
  const s = view.state
  if (s.phase === 'roundOver') {
    if (x >= NEXT_RECT.x && x <= NEXT_RECT.x + NEXT_RECT.w && y >= NEXT_RECT.y && y <= NEXT_RECT.y + NEXT_RECT.h) {
      return { kind: 'next' }
    }
  }
  if (s.phase === 'chooseRow') {
    for (let r = 0; r < ROW_COUNT; r += 1) {
      const top = ROW_Y + r * ROW_DY - 4
      if (x >= ROW_X - 6 && x <= ROW_X + 6 * ROW_CARD_W + 5 * ROW_CARD_GAP + 6 && y >= top && y <= top + ROW_CARD_H + 8) {
        return { kind: 'row', row: r }
      }
    }
  }
  if (s.phase === 'pick') {
    const n = s.yourHand.length
    for (let i = 0; i < n; i += 1) {
      const r = handCardRect(n, i)
      if (x >= r.x && x <= r.x + r.w && y >= r.y - 10 && y <= r.y + r.h) return { kind: 'hand', index: i }
    }
  }
  return null
}
