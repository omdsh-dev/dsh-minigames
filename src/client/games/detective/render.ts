/**
 * 侦探推理画布渲染：庄园 3×3 房间俯视（中央大厅为指认室）+ 侦探棋子、
 * 骰子与步数状态条、玩家 9 张手牌卡、三列记事排除格（自动标记）、盘问
 * 弹层（选嫌疑人 + 凶器）、指认弹层（三要素）、AI 应答横幅与胜负/暂停
 * 覆盖层。共享 theme 视觉件；全部为纯绘制与命中检测，无游戏状态。
 */
import { SUSPECTS, WEAPONS, ROOMS, CENTER_ROOM, cardName, type NoteMark } from './logic.ts'
import { THEME, accent, drawBackground, drawOverlay, glow, hudPair, noGlow, roundRectPath } from '../theme.ts'

export const LOGICAL_W = 480
export const LOGICAL_H = 660
export const HUD_H = 30

// ── 布局常量（报告逐项核算用）──────────────────────────────
/** 说明按钮矩形（右上角）。 */
export const HELP_BTN = { x: LOGICAL_W - 76, y: HUD_H + 2, w: 60, h: 24 }
/** 帮助面板文案（15px 大字）。 */
const HELP_LINES = [
  '玩法速览',
  '· 空格掷骰（1–3 步），点击高亮房间移动',
  '· 进房弹盘问层选嫌疑人+凶器：证人持匹配卡必亮一张（自动 × 排除）',
  '· 证人无匹配时：盘问三要素中不在你手里的必是底牌（自动 ★ 锁定）',
  '· 到中央大厅并原地再点它 → 指认三要素：全对胜，任一错即败，一局仅一次',
  '· 记事板三列自动维护：✓ 在手 × 已排除 ★ 锁定 · R 换局 · P 暂停',
]

/** 中央大厅速览条：y 30..52。 */
const QUICK_Y = 45
/** 棋盘：3×3，格 118×84，缝 8；x0=55 居中，y0=58。 */
const BOARD_X0 = 55
const BOARD_Y0 = 58
const CELL_W = 118
const CELL_H = 84
const CELL_GAP = 8
/** 状态条：骰子格 (10,332,26,24)，文案基线 350，右锚 x=470。 */
const DIE_RECT = { x: 10, y: 332, w: 26, h: 24 }
const STATUS_Y = 350
const STATUS_RIGHT_X = 470
/** 手牌：卡 84×40，缝 8；两行（5+4），x0=14，y=360/408。 */
const HAND_X0 = 14
const HAND_Y0 = 360
const HAND_W = 84
const HAND_H = 40
const HAND_GAP = 8
/** 记事板：面板 (10,454,460,192)，三列 x=14/168/322 宽 148，行高 17。 */
const NOTES_RECT = { x: 10, y: 454, w: 460, h: 192 }
const NOTES_COLS = [14, 168, 322]
const NOTES_COL_W = 148
const NOTES_HEAD_Y = 472
const NOTES_ROW0 = 486
const NOTES_ROW_H = 17
/** 弹层筹码：112×30，缝 8，每行 3 个。 */
const CHIP_W = 112
const CHIP_H = 30
const CHIP_GAP = 8
const CHIP_X0 = 64
/** 盘问弹层 (56,150,368,340)。 */
const SUG_RECT = { x: 56, y: 150, w: 368, h: 340 }
const SUG_SUS_Y = 210
const SUG_WPN_Y = 304
const SUG_BTN_Y = 396
/** 指认弹层 (56,110,368,440)。 */
const ACC_RECT = { x: 56, y: 110, w: 368, h: 440 }
const ACC_SUS_Y = 170
const ACC_WPN_Y = 266
const ACC_ROOM_Y0 = 362
const ACC_BTN_Y = 486
/** 弹层按钮 120×36。 */
const BTN_W = 120
const BTN_H = 36

/** 渲染所需的全部游戏视图状态（index.ts 持有并传入）。 */
export interface DetectiveView {
  pos: number
  die: number
  steps: number
  /** 骰子动画中显示的滚动面值（0 = 定格）。 */
  diceFace: number
  reachable: number[]
  hand: number[]
  notes: NoteMark[]
  /** 'idle' 待掷 / 'move' 待移动 / 'suggest' 盘问弹层 / 'accuse' 指认弹层。 */
  phase: 'idle' | 'move' | 'suggest' | 'accuse'
  /** 弹层内已选：嫌疑人 / 凶器 / 房间（-1 未选）。 */
  pickSuspect: number
  pickWeapon: number
  pickRoom: number
  /** AI 应答横幅（空串隐藏）。 */
  banner: string
  bannerGood: boolean
  toast: string
  status: 'playing' | 'won' | 'lost'
  /** 败局揭示底牌文本（won/lost 覆盖层用）。 */
  reveal: string
  streak: number
  paused: boolean
  /** 说明面板开关。 */
  helpOpen: boolean
}

/** 房间格矩形（含缝内命中）。 */
function roomRect(room: number): { x: number; y: number; w: number; h: number } {
  return {
    x: BOARD_X0 + (room % 3) * (CELL_W + CELL_GAP),
    y: BOARD_Y0 + Math.floor(room / 3) * (CELL_H + CELL_GAP),
    w: CELL_W,
    h: CELL_H,
  }
}

/**
 * 棋盘命中检测。
 * @returns 房间号 0..8，未命中返回 -1。
 */
export function roomAt(x: number, y: number): number {
  for (let r = 0; r < 9; r += 1) {
    const g = roomRect(r)
    if (x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h) return r
  }
  return -1
}

/** 一排筹码里点中的下标（-1 未中）。 */
function chipIndexAt(x: number, y: number, y0: number, count: number): number {
  for (let i = 0; i < count; i += 1) {
    const cx = CHIP_X0 + (i % 3) * (CHIP_W + CHIP_GAP)
    const cy = y0 + Math.floor(i / 3) * (CHIP_H + CHIP_GAP)
    if (x >= cx && x <= cx + CHIP_W && y >= cy && y <= cy + CHIP_H) return i
  }
  return -1
}

/** 盘问弹层命中：{type, index} 筹码 / 'ok' / 'cancel' / null。 */
export function suggestHit(x: number, y: number): { type: 'suspect' | 'weapon'; index: number } | 'ok' | 'cancel' | null {
  const si = chipIndexAt(x, y, SUG_SUS_Y, 6)
  if (si >= 0) return { type: 'suspect', index: si }
  const wi = chipIndexAt(x, y, SUG_WPN_Y, 6)
  if (wi >= 0) return { type: 'weapon', index: wi }
  if (inRect(x, y, 88, SUG_BTN_Y)) return 'cancel'
  if (inRect(x, y, 272, SUG_BTN_Y)) return 'ok'
  return null
}

/** 指认弹层命中：{type, index} 筹码 / 'ok' / 'cancel' / null。 */
export function accuseHit(x: number, y: number): { type: 'suspect' | 'weapon' | 'room'; index: number } | 'ok' | 'cancel' | null {
  const si = chipIndexAt(x, y, ACC_SUS_Y, 6)
  if (si >= 0) return { type: 'suspect', index: si }
  const wi = chipIndexAt(x, y, ACC_WPN_Y, 6)
  if (wi >= 0) return { type: 'weapon', index: wi }
  const ri = chipIndexAt(x, y, ACC_ROOM_Y0, 9)
  if (ri >= 0) return { type: 'room', index: ri }
  if (inRect(x, y, 88, ACC_BTN_Y)) return 'cancel'
  if (inRect(x, y, 272, ACC_BTN_Y)) return 'ok'
  return null
}

function inRect(x: number, y: number, bx: number, by: number): boolean {
  return x >= bx && x <= bx + BTN_W && y >= by && y <= by + BTN_H
}

/** 一枚可选筹码：名称 + 选中/未选两种描边。 */
function drawChip(ctx: CanvasRenderingContext2D, cx: number, cy: number, label: string, selected: boolean, edge: string): void {
  roundRectPath(ctx, cx, cy, CHIP_W, CHIP_H, 7)
  ctx.fillStyle = selected ? edge : THEME.panel
  ctx.fill()
  ctx.strokeStyle = selected ? THEME.text : THEME.panelEdge
  ctx.lineWidth = selected ? 2 : 1.2
  ctx.stroke()
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = selected ? '#15151b' : THEME.text
  ctx.fillText(label, cx + CHIP_W / 2, cy + CHIP_H / 2)
  ctx.textBaseline = 'alphabetic'
}

/** 面板底：暗底 + 边框 + 标题。 */
function drawPanel(ctx: CanvasRenderingContext2D, r: { x: number; y: number; w: number; h: number }, title: string): void {
  ctx.fillStyle = 'rgba(13,13,20,0.86)'
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H)
  glow(ctx, THEME.panelEdge, 12)
  roundRectPath(ctx, r.x, r.y, r.w, r.h, 12)
  ctx.fillStyle = THEME.panel
  ctx.fill()
  noGlow(ctx)
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.font = 'bold 17px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = THEME.text
  ctx.fillText(title, r.x + r.w / 2, r.y + 28)
}

/** 弹层底部 取消/确认 双按钮。 */
function drawButtons(ctx: CanvasRenderingContext2D, y: number, okLabel: string, okEnabled: boolean): void {
  ctx.font = '600 14px system-ui, sans-serif'
  ctx.textBaseline = 'middle'
  const defs: Array<{ label: string; x: number; edge: string; text: string }> = [
    { label: '取消', x: 88, edge: THEME.panelEdge, text: THEME.text },
    { label: okLabel, x: 272, edge: okEnabled ? THEME.accents[2]! : THEME.panelEdge, text: okEnabled ? THEME.text : THEME.textMuted },
  ]
  for (const b of defs) {
    roundRectPath(ctx, b.x, y, BTN_W, BTN_H, 8)
    ctx.fillStyle = THEME.panel
    ctx.fill()
    ctx.strokeStyle = b.edge
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.fillStyle = b.text
    ctx.fillText(b.label, b.x + BTN_W / 2, y + BTN_H / 2)
  }
  ctx.textBaseline = 'alphabetic'
}

/** 棋子小侦探（圆头 + 帽檐）。 */
function drawPiece(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  glow(ctx, THEME.accents[0]!, 10)
  ctx.beginPath()
  ctx.arc(cx, cy, 9, 0, Math.PI * 2)
  ctx.fillStyle = THEME.accents[0]!
  ctx.fill()
  noGlow(ctx)
  ctx.beginPath()
  ctx.ellipse(cx, cy - 6, 11, 4, 0, 0, Math.PI * 2)
  ctx.fillStyle = '#3b3b52'
  ctx.fill()
}

/** 骰面点阵（1–3）。 */
function drawDieFace(ctx: CanvasRenderingContext2D, cx: number, cy: number, v: number): void {
  const pip = (px: number, py: number): void => {
    ctx.beginPath()
    ctx.arc(cx + px, cy + py, 2.6, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = '#e8e8f2'
  if (v >= 1) pip(-5, -5)
  if (v >= 2) pip(5, 5)
  if (v >= 3) pip(5, -5)
  if (v === 0) { pip(-4, 0); pip(4, 0) }
}

function drawBoard(ctx: CanvasRenderingContext2D, view: DetectiveView): void {
  for (let r = 0; r < 9; r += 1) {
    const g = roomRect(r)
    const isCenter = r === CENTER_ROOM
    const here = view.pos === r
    const canGo = view.phase === 'move' && view.reachable.includes(r)
    roundRectPath(ctx, g.x, g.y, g.w, g.h, 9)
    ctx.fillStyle = isCenter ? 'rgba(224,175,104,0.10)' : THEME.panel
    ctx.fill()
    ctx.strokeStyle = isCenter ? THEME.gold : canGo ? THEME.accents[2]! : THEME.panelEdge
    ctx.lineWidth = isCenter ? 2 : canGo ? 2.2 : 1.2
    ctx.stroke()
    ctx.font = '600 14px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = isCenter ? THEME.gold : THEME.text
    ctx.fillText(ROOMS[r]!, g.x + g.w / 2, g.y + 22)
    ctx.font = '600 10px system-ui, sans-serif'
    ctx.fillStyle = THEME.textMuted
    const sub = isCenter ? '指认室' : canGo ? '可进入' : r === view.pos ? '你在这' : ''
    if (sub !== '') ctx.fillText(sub, g.x + g.w / 2, g.y + 38)
    if (here) drawPiece(ctx, g.x + g.w / 2, g.y + g.h / 2 + 8)
  }
}

function drawStatus(ctx: CanvasRenderingContext2D, view: DetectiveView): void {
  roundRectPath(ctx, DIE_RECT.x, DIE_RECT.y, DIE_RECT.w, DIE_RECT.h, 6)
  ctx.fillStyle = THEME.panel
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  drawDieFace(ctx, DIE_RECT.x + DIE_RECT.w / 2, DIE_RECT.y + DIE_RECT.h / 2, view.diceFace)
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = THEME.text
  ctx.fillText(view.phase === 'move' ? '剩 ' + view.steps + ' 步 · 点击高亮房间' : '空格掷骰', 46, STATUS_Y)
  ctx.textAlign = 'right'
  ctx.fillStyle = view.pos === CENTER_ROOM && view.phase === 'idle' ? THEME.gold : THEME.textMuted
  const hint = view.status !== 'playing' ? ''
    : view.pos === CENTER_ROOM && view.phase === 'idle' ? '点击中央大厅指认'
    : view.phase === 'move' ? '掷出 ' + view.die
    : '回合 ' + (view.steps > 0 ? '移动中' : '待掷')
  if (hint !== '') ctx.fillText(hint, STATUS_RIGHT_X, STATUS_Y)
}

function drawHand(ctx: CanvasRenderingContext2D, view: DetectiveView): void {
  for (let i = 0; i < view.hand.length; i += 1) {
    const cx = HAND_X0 + (i % 5) * (HAND_W + HAND_GAP)
    const cy = HAND_Y0 + Math.floor(i / 5) * (HAND_H + HAND_GAP)
    const card = view.hand[i]!
    const color = accent(card)
    roundRectPath(ctx, cx, cy, HAND_W, HAND_H, 7)
    ctx.fillStyle = THEME.panel
    ctx.fill()
    ctx.strokeStyle = color
    ctx.lineWidth = 1.4
    ctx.stroke()
    ctx.font = '600 13px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = color
    ctx.fillText(cardName(card), cx + HAND_W / 2, cy + 16)
    ctx.font = '600 9px system-ui, sans-serif'
    ctx.fillStyle = THEME.textMuted
    const kind = card < 6 ? '嫌疑人' : card < 12 ? '凶器' : '房间'
    ctx.fillText(kind, cx + HAND_W / 2, cy + 30)
  }
}

const MARK_GLYPH: Record<NoteMark, string> = { held: '✓', excluded: '✗', confirmed: '★', unknown: '·' }
const MARK_COLOR: Record<NoteMark, string> = {
  held: THEME.good, excluded: THEME.bad, confirmed: THEME.gold, unknown: THEME.textMuted,
}

function drawNotes(ctx: CanvasRenderingContext2D, view: DetectiveView): void {
  roundRectPath(ctx, NOTES_RECT.x, NOTES_RECT.y, NOTES_RECT.w, NOTES_RECT.h, 8)
  ctx.fillStyle = 'rgba(30,30,42,0.6)'
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.textAlign = 'left'
  const heads = ['嫌疑人', '凶器', '房间']
  for (let c = 0; c < 3; c += 1) {
    ctx.fillStyle = THEME.textMuted
    ctx.fillText(heads[c]!, NOTES_COLS[c]!, NOTES_HEAD_Y)
  }
  ctx.font = '600 12px system-ui, sans-serif'
  const colDefs: Array<{ names: readonly string[]; off: number }> = [
    { names: SUSPECTS, off: 0 },
    { names: WEAPONS, off: 6 },
    { names: ROOMS, off: 12 },
  ]
  for (let c = 0; c < 3; c += 1) {
    const def = colDefs[c]!
    for (let i = 0; i < def.names.length; i += 1) {
      const y = NOTES_ROW0 + i * NOTES_ROW_H
      const mark = view.notes[def.off + i]!
      ctx.textAlign = 'left'
      ctx.fillStyle = mark === 'unknown' ? THEME.textMuted : THEME.text
      ctx.fillText(def.names[i]!, NOTES_COLS[c]! + 8, y)
      ctx.textAlign = 'right'
      ctx.fillStyle = MARK_COLOR[mark]
      ctx.fillText(MARK_GLYPH[mark], NOTES_COLS[c]! + NOTES_COL_W - 8, y)
    }
  }
}

function drawSuggestModal(ctx: CanvasRenderingContext2D, view: DetectiveView): void {
  drawPanel(ctx, SUG_RECT, '盘问 · ' + ROOMS[view.pos]!)
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('嫌疑人', CHIP_X0, SUG_SUS_Y - 8)
  ctx.fillText('凶器', CHIP_X0, SUG_WPN_Y - 8)
  for (let i = 0; i < 6; i += 1) {
    const cx = CHIP_X0 + (i % 3) * (CHIP_W + CHIP_GAP)
    drawChip(ctx, cx, SUG_SUS_Y + Math.floor(i / 3) * (CHIP_H + CHIP_GAP), SUSPECTS[i]!, view.pickSuspect === i, accent(i))
    drawChip(ctx, cx, SUG_WPN_Y + Math.floor(i / 3) * (CHIP_H + CHIP_GAP), WEAPONS[i]!, view.pickWeapon === i, accent(i + 2))
  }
  drawButtons(ctx, SUG_BTN_Y, '盘问', view.pickSuspect >= 0 && view.pickWeapon >= 0)
}

function drawAccuseModal(ctx: CanvasRenderingContext2D, view: DetectiveView): void {
  drawPanel(ctx, ACC_RECT, '最终指认（仅一次）')
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('嫌疑人', CHIP_X0, ACC_SUS_Y - 8)
  ctx.fillText('凶器', CHIP_X0, ACC_WPN_Y - 8)
  ctx.fillText('房间', CHIP_X0, ACC_ROOM_Y0 - 8)
  for (let i = 0; i < 6; i += 1) {
    const cx = CHIP_X0 + (i % 3) * (CHIP_W + CHIP_GAP)
    drawChip(ctx, cx, ACC_SUS_Y + Math.floor(i / 3) * (CHIP_H + CHIP_GAP), SUSPECTS[i]!, view.pickSuspect === i, accent(i))
    drawChip(ctx, cx, ACC_WPN_Y + Math.floor(i / 3) * (CHIP_H + CHIP_GAP), WEAPONS[i]!, view.pickWeapon === i, accent(i + 2))
  }
  for (let i = 0; i < 9; i += 1) {
    const cx = CHIP_X0 + (i % 3) * (CHIP_W + CHIP_GAP)
    const cy = ACC_ROOM_Y0 + Math.floor(i / 3) * (CHIP_H + CHIP_GAP)
    drawChip(ctx, cx, cy, ROOMS[i]!, view.pickRoom === i, accent(i + 4))
  }
  drawButtons(ctx, ACC_BTN_Y, '指认', view.pickSuspect >= 0 && view.pickWeapon >= 0 && view.pickRoom >= 0)
}

/**
 * 绘制一帧：背景 → HUD → 速览条 → 棋盘 → 状态条 → 手牌 → 记事板 →
 * AI 应答横幅 → 弹层 → 胜负/暂停覆盖层。
 */
export function renderDetective(ctx: CanvasRenderingContext2D, view: DetectiveView): void {
  ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H)
  drawBackground(ctx, LOGICAL_W, LOGICAL_H)

  ctx.fillStyle = THEME.panel
  ctx.fillRect(0, 0, LOGICAL_W, HUD_H)
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, LOGICAL_W - 1, HUD_H - 1)
  hudPair(ctx, 10, 20, '连胜 ', String(view.streak), 'left', view.streak > 0 ? THEME.gold : THEME.text)
  hudPair(ctx, LOGICAL_W - 10, 20, '房间 ', ROOMS[view.pos]!, 'right')


  drawBoard(ctx, view)
  drawStatus(ctx, view)
  drawHand(ctx, view)
  drawNotes(ctx, view)

  if (view.banner !== '') {
    roundRectPath(ctx, 90, 240, 300, 80, 10)
    ctx.fillStyle = THEME.panel
    glow(ctx, view.bannerGood ? THEME.good : THEME.bad, 10)
    ctx.fill()
    noGlow(ctx)
    ctx.strokeStyle = view.bannerGood ? THEME.good : THEME.bad
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.font = '600 15px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = view.bannerGood ? THEME.good : THEME.bad
    ctx.fillText(view.banner, 240, 286)
  }

  if (view.toast !== '') {
    ctx.font = '600 13px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = THEME.bad
    ctx.fillText(view.toast, LOGICAL_W / 2, 350)
  }

  if (view.phase === 'suggest') drawSuggestModal(ctx, view)
  else if (view.phase === 'accuse') drawAccuseModal(ctx, view)

  if (view.status === 'won') {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '破案！', view.reveal + ' · 空格 / 点击再来一局', THEME.good)
  } else if (view.status === 'lost') {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '指认失误', '真相：' + view.reveal + ' · 空格 / 点击再来一局', THEME.bad)
  } else if (view.paused) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '已暂停', '按 P 继续', THEME.text)
  }

  // 说明面板：最上层渲染。
  if (view.helpOpen) {
    const hp = { x: LOGICAL_W / 2 - 230, y: 140, w: 460, h: 196 }
    ctx.fillStyle = 'rgba(13,13,20,0.93)'
    roundRectPath(ctx, hp.x, hp.y, hp.w, hp.h, 10)
    ctx.fill()
    ctx.strokeStyle = THEME.panelEdge
    ctx.stroke()
    ctx.textAlign = 'left'
    ctx.font = '600 15px system-ui, sans-serif'
    HELP_LINES.forEach((line, i) => {
      ctx.fillStyle = i === 0 ? accent(2) : THEME.text
      ctx.fillText(line, hp.x + 14, hp.y + 28 + i * 26)
    })
  }
  // 说明按钮（替代 11px 小字速览——字太小；点击弹 15px 帮助面板）。
  const hb = HELP_BTN
  ctx.fillStyle = THEME.panel
  roundRectPath(ctx, hb.x, hb.y, hb.w, hb.h, 7)
  ctx.fill()
  ctx.strokeStyle = view.helpOpen ? accent(2) : THEME.panelEdge
  ctx.lineWidth = view.helpOpen ? 2 : 1
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.textAlign = 'center'
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.fillStyle = view.helpOpen ? accent(2) : THEME.textMuted
  ctx.fillText('说明', hb.x + hb.w / 2, hb.y + 18)

}
