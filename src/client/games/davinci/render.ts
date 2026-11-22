/**
 * 达芬奇密码渲染器：木桌面、对方一列暗牌（翻开亮显金框）、己方一列明
 * 牌（白/黑底色 + 短横线标记）、公共牌堆（可点击摸牌）、待插牌与插入
 * 箭头、数值猜测选择面板、AI 思考提示、局分 HUD、猜错揭示翻面动画、
 * 一局结束面板与胜负遮罩。全部为纯 canvas 绘制，状态由 index.ts 传入
 * （见 DavinciView）。
 */
import {
  legalInsertPositions, sortKey, type DavinciCard, type DavinciState,
} from './logic.ts'
import { THEME, accent, drawBackground, drawOverlay, glow, hudPair, noGlow, roundRectPath } from '../theme.ts'

/** 逻辑画布宽度 px。 */
export const W = 780
/** 逻辑画布高度 px。 */
export const H = 580
/** 牌宽 px。 */
export const CARD_W = 56
/** 牌高 px。 */
export const CARD_H = 72
/** 牌间距 px。 */
const CARD_GAP = 12
/** 对方牌行顶 y。 */
export const AI_Y = 70
/** 己方牌行顶 y。 */
export const MY_Y = 300
/** AI 思考提示基线 y。 */
const THINK_Y = 164
/** 消息行基线 y。 */
const MSG_Y = 196
/** 牌堆矩形。 */
export const PILE_RECT = { x: 24, y: 210, w: 64, h: 84 }
/** 数值选择面板（12 个数值按钮 4×3）。 */
const PICK_COLS = 4
const PICK_BTN_W = 88
const PICK_BTN_H = 34
const PICK_GAP = 12
const PICK_W = PICK_COLS * PICK_BTN_W + (PICK_COLS - 1) * PICK_GAP
const PICK_X = (W - PICK_W) / 2
const PICK_Y = 410
/** 一局结束面板与「下一局」按钮。 */
const NEXT_PANEL = { x: 230, y: 180, w: 320, h: 118 }
const NEXT_RECT = { x: 290, y: 244, w: 200, h: 42 }
/** 说明按钮矩形（右下角）。 */
export const HELP_BTN = { x: W - 76, y: H - 34, w: 60, h: 26 }
/** 帮助面板矩形（底部居中弹层）。 */
const HELP_PANEL = { x: W / 2 - 260, y: H - 176, w: 520, h: 150 }
/** 帮助面板文案（16px 大字）。 */
const HELP_LINES = [
  '玩法速览',
  '· 点牌堆摸牌 → 点亮色箭头插入 → 点对方牌位猜数值',
  '· 猜对：牌翻开，可继续猜；猜错：自己翻开一张最接近的牌',
  '· 手牌按数值升序（同值白前黑后）；只猜数值不猜颜色',
  '· 空格结束回合 · R 重开 · P 暂停 · 再点「说明」关闭',
]

/** 底部常驻速览基线 y（已改说明按钮，保留坐标备用）。 */
const HINT_Y = 566

/** 命中区域：牌堆 / 对方牌位 / 插入槽 / 数值按钮 / 下一局。 */
export type HitRegion =
  | { kind: 'help' }
  | { kind: 'pile' }
  | { kind: 'aiCard'; index: number }
  | { kind: 'insert'; index: number }
  | { kind: 'insertEnd' }
  | { kind: 'value'; value: number }
  | { kind: 'next' }

/** 一次渲染所需的全部状态。 */
export interface DavinciView {
  state: DavinciState
  /** 正在猜的对方牌位（null 关闭面板）。 */
  picking: number | null
  /** 翻面动画进度 0-1。 */
  reveal: number
  /** AI 是否思考中（驱动提示与动画点）。 */
  aiThinking: boolean
  paused: boolean
}

/** 一行牌的各张矩形（水平居中）。 */
export function handRects(count: number, y: number): { x: number; y: number; w: number; h: number }[] {
  // 自适应：手牌增多超出可用宽度时按比例收窄牌宽与间距（高度不变，
  // 牌数多时数值字号随宽度缩小由 drawCardFace 的 fw 门控兜底）。
  const total = count * CARD_W + Math.max(0, count - 1) * CARD_GAP
  const scale = total > W - 48 ? (W - 48) / total : 1
  const w = CARD_W * scale
  const gap = CARD_GAP * scale
  const x0 = (W - (count * w + Math.max(0, count - 1) * gap)) / 2
  const out: { x: number; y: number; w: number; h: number }[] = []
  for (let i = 0; i < count; i += 1) {
    out.push({ x: x0 + i * (w + gap), y, w, h: CARD_H })
  }
  return out
}

/** 牌背：深木纹色 + 中心纹章。 */
function drawCardBack(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  roundRectPath(ctx, x, y, w, h, 7)
  ctx.fillStyle = '#5d4a36'
  ctx.fill()
  ctx.strokeStyle = 'rgba(226,200,150,0.45)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  if (w > 14) {
    ctx.fillStyle = 'rgba(226,200,150,0.5)'
    ctx.beginPath()
    ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) * 0.15, 0, Math.PI * 2)
    ctx.fill()
  }
}

/**
 * 画一张明牌：白牌米白底、黑牌深底，数值居中，短横牌数值下加一短横；
 * revealed 为金框亮显（已被对手知晓）。flip 为横向翻面进度。
 */
function drawCardFace(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
  card: DavinciCard, revealed: boolean, flip: number, highlight: boolean,
): void {
  if (flip < 0.5) {
    const t = Math.max(1 - flip * 2, 0.04)
    drawCardBack(ctx, x + (w - w * t) / 2, y, w * t, h)
    return
  }
  const t = Math.max((flip - 0.5) * 2, 0.04)
  const fw = w * t
  const fx = x + (w - fw) / 2
  roundRectPath(ctx, fx, y, fw, h, 7)
  ctx.fillStyle = card.color === 'w' ? '#efe6d2' : '#2a2a38'
  ctx.fill()
  ctx.strokeStyle = revealed ? THEME.gold : highlight ? accent(0) : 'rgba(20,16,10,0.45)'
  ctx.lineWidth = revealed ? 2.5 : highlight ? 2.5 : 1
  if (revealed) glow(ctx, THEME.gold, 8)
  ctx.stroke()
  noGlow(ctx)
  if (fw < w * 0.35) return
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = 'bold 26px system-ui, sans-serif'
  ctx.fillStyle = card.color === 'w' ? '#3a3020' : '#e2e2ee'
  const label = String(card.value)
  ctx.fillText(label, fx + fw / 2, y + h / 2 - (card.dash ? 6 : 0))
  if (card.dash) {
    ctx.strokeStyle = card.color === 'w' ? '#3a3020' : '#e2e2ee'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(fx + fw / 2 - 12, y + h / 2 + 14)
    ctx.lineTo(fx + fw / 2 + 12, y + h / 2 + 14)
    ctx.stroke()
  }
  ctx.textBaseline = 'alphabetic'
}

/** 牌堆叠放与「点击摸牌」提示。 */
function drawPile(ctx: CanvasRenderingContext2D, count: number, enabled: boolean): void {
  const layers = Math.min(3, count)
  for (let i = layers - 1; i >= 0; i -= 1) {
    drawCardBack(ctx, PILE_RECT.x + i * 3, PILE_RECT.y - i * 3, PILE_RECT.w, PILE_RECT.h)
  }
  if (enabled) {
    roundRectPath(ctx, PILE_RECT.x - 3, PILE_RECT.y - 3, PILE_RECT.w + 6, PILE_RECT.h + 6, 9)
    ctx.strokeStyle = accent(2)
    ctx.lineWidth = 2
    glow(ctx, accent(2), 8)
    ctx.stroke()
    noGlow(ctx)
  }
  ctx.textAlign = 'center'
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText(count > 0 ? '牌堆 ' + count : '牌堆空', PILE_RECT.x + PILE_RECT.w / 2, PILE_RECT.y + PILE_RECT.h + 18)
}

/** 数值选择面板：猜指定牌位的数值（0-11 十二宫格）。 */
function drawPicker(ctx: CanvasRenderingContext2D, index: number): void {
  ctx.fillStyle = 'rgba(13,13,20,0.55)'
  ctx.fillRect(0, 0, W, H)
  ctx.textAlign = 'center'
  ctx.font = '600 14px system-ui, sans-serif'
  ctx.fillStyle = THEME.text
  ctx.fillText('猜第 ' + (index + 1) + ' 张牌的数值', W / 2, PICK_Y - 16)
  for (let v = 0; v <= 11; v += 1) {
    const col = v % PICK_COLS
    const row = Math.floor(v / PICK_COLS)
    const bx = PICK_X + col * (PICK_BTN_W + PICK_GAP)
    const by = PICK_Y + row * (PICK_BTN_H + PICK_GAP)
    roundRectPath(ctx, bx, by, PICK_BTN_W, PICK_BTN_H, 7)
    ctx.fillStyle = THEME.panel
    ctx.fill()
    ctx.strokeStyle = THEME.panelEdge
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.font = 'bold 17px system-ui, sans-serif'
    ctx.fillStyle = THEME.text
    ctx.fillText(String(v), bx + PICK_BTN_W / 2, by + PICK_BTN_H / 2 + 6)
  }
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('点数值确认 · 再点牌位换目标', W / 2, PICK_Y + 3 * (PICK_BTN_H + PICK_GAP) + 12)
}

/**
 * 命中测试：按优先级返回选择面板 > 下一局 > 牌堆 / 对方牌位 / 插入槽。
 * @param x - 逻辑坐标 x。
 * @param y - 逻辑坐标 y。
 * @param view - 当前渲染状态。
 * @returns 命中区域或 null。
 */
export function hitTest(x: number, y: number, view: DavinciView): HitRegion | null {
  if (x >= HELP_BTN.x && x <= HELP_BTN.x + HELP_BTN.w && y >= HELP_BTN.y && y <= HELP_BTN.y + HELP_BTN.h) return { kind: 'help' }
  const s = view.state
  if (s.phase === 'matchOver') return null
  if (s.phase === 'roundOver') {
    if (x >= NEXT_RECT.x && x <= NEXT_RECT.x + NEXT_RECT.w && y >= NEXT_RECT.y && y <= NEXT_RECT.y + NEXT_RECT.h) {
      return { kind: 'next' }
    }
    return null
  }
  if (view.picking !== null) {
    for (let v = 0; v <= 11; v += 1) {
      const col = v % PICK_COLS
      const row = Math.floor(v / PICK_COLS)
      const bx = PICK_X + col * (PICK_BTN_W + PICK_GAP)
      const by = PICK_Y + row * (PICK_BTN_H + PICK_GAP)
      if (x >= bx && x <= bx + PICK_BTN_W && y >= by && y <= by + PICK_BTN_H) return { kind: 'value', value: v }
    }
    return null
  }
  const myTurn = s.turn === 'you' && s.phase === 'playing'
  if (myTurn && s.pending === null) {
    const aiRects = handRects(s.aiHand.length, AI_Y)
    for (let i = 0; i < aiRects.length; i += 1) {
      const r = aiRects[i]!
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return { kind: 'aiCard', index: i }
    }
    if (s.drew !== 'you' && s.pile.length > 0
      && x >= PILE_RECT.x && x <= PILE_RECT.x + PILE_RECT.w
      && y >= PILE_RECT.y && y <= PILE_RECT.y + PILE_RECT.h) {
      return { kind: 'pile' }
    }
  }
  if (myTurn && s.pending !== null) {
    const rects = handRects(s.yourHand.length, MY_Y)
    for (let i = 0; i < rects.length; i += 1) {
      const r = rects[i]!
      if (x >= r.x - CARD_GAP / 2 && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return { kind: 'insert', index: i }
    }
    const last = rects[rects.length - 1]
    if (last !== undefined && x > last.x + last.w && x < last.x + last.w + CARD_GAP + 12
      && y >= last.y && y <= last.y + last.h) {
      return { kind: 'insertEnd' }
    }
  }
  return null
}

/**
 * 整帧渲染。
 * @param ctx - 画布上下文（逻辑坐标系）。
 * @param view - 渲染状态。
 */
export function renderDavinci(ctx: CanvasRenderingContext2D, helpOpen: boolean, view: DavinciView): void {
  const s = view.state
  drawBackground(ctx, W, H)
  // 局分 HUD（左）与牌堆余量（右锚，动态宽度安全）。
  hudPair(ctx, 16, 24, '局分', s.roundWinsYou + ' : ' + s.roundWinsAi, 'left', THEME.gold)
  hudPair(ctx, W - 16, 24, '第' + s.round + '局', '你 ' + s.revealedAi.filter(Boolean).length + '/' + s.aiHand.length + ' 已翻开', 'right')
  ctx.textAlign = 'left'
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('对方的手牌', 24, AI_Y - 10)
  ctx.fillText('你的手牌', 104, MY_Y - 10) // 避开左侧牌堆（x 24-88, y 210-294）

  // 对方一列：未翻开牌背、已翻开亮显；翻面动画只在最近翻开的那张上播。
  const aiRects = handRects(s.aiHand.length, AI_Y)
  const last = s.lastReveal
  for (let i = 0; i < s.aiHand.length; i += 1) {
    const r = aiRects[i]!
    const card = s.aiHand[i]!
    const isLast = last !== null && last.side === 'ai' && last.index === i
    const flip = isLast && view.reveal < 1 ? view.reveal : 1
    if (s.revealedAi[i] === true || (isLast && view.reveal >= 0.5)) {
      drawCardFace(ctx, r.x, r.y, r.w, r.h, card, s.revealedAi[i] === true, flip, view.picking === i)
    } else {
      drawCardBack(ctx, r.x, r.y, r.w, r.h)
      if (view.picking === i) {
        roundRectPath(ctx, r.x - 2, r.y - 2, r.w + 4, r.h + 4, 9)
        ctx.strokeStyle = accent(0)
        ctx.lineWidth = 2
        glow(ctx, accent(0), 8)
        ctx.stroke()
        noGlow(ctx)
      }
    }
    ctx.textAlign = 'center'
    ctx.font = '600 11px system-ui, sans-serif'
    ctx.fillStyle = THEME.textMuted
    ctx.fillText(String(i + 1), r.x + r.w / 2, r.y + r.h + 14)
  }

  // 消息与 AI 思考提示。
  ctx.textAlign = 'center'
  ctx.font = '600 15px system-ui, sans-serif'
  ctx.fillStyle = THEME.text
  if (s.phase === 'playing') {
    ctx.fillText(view.aiThinking && s.turn === 'ai' ? '对方思考中…' : s.message, W / 2, MSG_Y)
  }

  drawPile(ctx, s.pile.length, s.turn === 'you' && s.phase === 'playing' && s.drew !== 'you' && s.pending === null && s.pile.length > 0)

  // 己方一列明牌；待插牌挂中上并画插入箭头。
  const myRects = handRects(s.yourHand.length, MY_Y)
  for (let i = 0; i < s.yourHand.length; i += 1) {
    const r = myRects[i]!
    const card = s.yourHand[i]!
    const isLast = last !== null && last.side === 'you' && last.index === i
    const flip = isLast && view.reveal < 1 ? view.reveal : 1
    drawCardFace(ctx, r.x, r.y, r.w, r.h, card, s.revealedYou[i] === true, flip, false)
  }
  if (s.pending !== null) {
    drawCardFace(ctx, W / 2 - CARD_W / 2, 204, CARD_W, CARD_H, s.pending, false, 1, true)
    ctx.textAlign = 'center'
    ctx.font = '600 12px system-ui, sans-serif'
    ctx.fillStyle = accent(2)
    const legal = legalInsertPositions(s.yourHand, s.pending)
    ctx.fillText('点击插入位置（保持升序）', W / 2, 292)
    for (const p of legal) {
      const r = myRects[p]
      const ax = r !== undefined ? r.x - CARD_GAP / 2 : (myRects[myRects.length - 1]!.x + CARD_W + CARD_GAP / 2)
      ctx.fillStyle = accent(2)
      ctx.beginPath()
      ctx.moveTo(ax - 4, MY_Y + CARD_H / 2 - 7)
      ctx.lineTo(ax + 4, MY_Y + CARD_H / 2)
      ctx.lineTo(ax - 4, MY_Y + CARD_H / 2 + 7)
      ctx.fill()
    }
  }

  // 说明按钮（替代原 12px 常驻速览——字太小且常驻拥挤；点击弹出 16px 帮助面板）。
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
  ctx.fillText('说明', hb.x + hb.w / 2, hb.y + 17)
  if (helpOpen) {
    // 帮助面板：半透明底 + 16px 大字玩法速览（含易误解点）。
    ctx.fillStyle = 'rgba(13,13,20,0.92)'
    roundRectPath(ctx, HELP_PANEL.x, HELP_PANEL.y, HELP_PANEL.w, HELP_PANEL.h, 10)
    ctx.fill()
    ctx.strokeStyle = THEME.panelEdge
    ctx.stroke()
    ctx.textAlign = 'left'
    ctx.font = '600 16px system-ui, sans-serif'
    ctx.fillStyle = THEME.text
    HELP_LINES.forEach((line, i) => {
      ctx.fillStyle = i === 0 ? accent(2) : THEME.text
      ctx.fillText(line, HELP_PANEL.x + 16, HELP_PANEL.y + 30 + i * 26)
    })
  }

  if (s.phase === 'roundOver') {
    ctx.fillStyle = 'rgba(13,13,20,0.72)'
    roundRectPath(ctx, NEXT_PANEL.x, NEXT_PANEL.y, NEXT_PANEL.w, NEXT_PANEL.h, 10)
    ctx.fill()
    ctx.textAlign = 'center'
    ctx.font = 'bold 20px system-ui, sans-serif'
    ctx.fillStyle = s.roundWinsYou > s.roundWinsAi ? THEME.good : THEME.bad
    ctx.fillText(s.roundWinsYou > s.roundWinsAi ? '本局胜利' : '本局失利', W / 2, NEXT_PANEL.y + 36)
    roundRectPath(ctx, NEXT_RECT.x, NEXT_RECT.y, NEXT_RECT.w, NEXT_RECT.h, 8)
    ctx.fillStyle = accent(0)
    ctx.fill()
    ctx.font = '600 15px system-ui, sans-serif'
    ctx.fillStyle = '#14141c'
    ctx.fillText('下一局（空格）', W / 2, NEXT_RECT.y + 27)
  }
  if (s.phase === 'matchOver' && s.matchWinner !== null) {
    drawOverlay(
      ctx, W, H,
      s.matchWinner === 'you' ? '比赛胜利' : '比赛失利',
      s.roundWinsYou + ' : ' + s.roundWinsAi + ' · 按 R 重开',
      s.matchWinner === 'you' ? THEME.gold : THEME.bad,
    )
  } else if (view.paused) {
    drawOverlay(ctx, W, H, '已暂停', '按 P 继续 · R 重开')
  }
  if (view.picking !== null) drawPicker(ctx, view.picking)
}

/** 排序键重导出（渲染层插入箭头校验用）。 */
export { sortKey }
