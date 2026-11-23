/**
 * 国际跳棋渲染：木纹棋盘（深浅格）+ 圆形棋子（冠冕表王）+ 选中与可
 * 走点提示 + 必吃高亮警示 + 最后一步金框标记 + 局分 HUD + 胜负 overlay。
 * 「说明」按钮与帮助面板在渲染函数末尾绘制，始终位于最上层。所有随
 * 机粒子由 index.ts 持有，本模块只做纯绘制。
 */
import { THEME, accent, drawBackground, drawOverlay, glow, hudPair, noGlow, roundRectPath } from '../theme.ts'
import { sideOfPiece, isKing, type DraughtsMove, type DraughtsPosition, type Piece } from './logic.ts'

/** 逻辑画布宽（px）。 */
export const LOGICAL_W = 560
/** 逻辑画布高（px）。 */
export const LOGICAL_H = 608

const BOARD_X = 40
const BOARD_Y = 44
const CELL = 60
const BOARD_SIZE = CELL * 8

/** 「说明」按钮矩形（渲染末尾绘制、命中检测复用）。 */
export const HELP_RECT = { x: 488, y: 552, w: 60, h: 24 }

/** 浅格（木色亮）与深格（木色暗）及外框色。 */
const WOOD_LIGHT = '#c9a06c'
const WOOD_DARK = '#7c5433'
const WOOD_EDGE = '#4a3220'

/** 红方 / 黑方棋子主体与描边色。 */
const RED_BODY = '#d9534f'
const RED_EDGE = '#8f2f2f'
const BLACK_BODY = '#454458'
const BLACK_EDGE = '#23222f'

/** 渲染一帧所需的全部展示状态（index.ts 组装）。 */
export interface DraughtsView {
  pos: DraughtsPosition
  selected: number
  targets: Set<number>
  /** 有吃必吃时，全部可吃子的起点集合（红圈警示）。 */
  captureFroms: Set<number>
  lastMove: DraughtsMove | null
  youWins: number
  aiWins: number
  round: number
  statusText: string
  statusColor: string
  /** 胜负 / 暂停遮罩；null 表示不画。 */
  overlay: { text: string; sub: string; color: string } | null
  helpOpen: boolean
}

/**
 * 逻辑坐标 → 棋盘格（0-63）；棋盘外返回 -1。
 * @param x 逻辑 x。
 * @param y 逻辑 y。
 */
export function squareAt(x: number, y: number): number {
  const c = Math.floor((x - BOARD_X) / CELL)
  const r = Math.floor((y - BOARD_Y) / CELL)
  if (r < 0 || r > 7 || c < 0 || c > 7) return -1
  return r * 8 + c
}

/**
 * 逻辑坐标是否命中「说明」按钮。
 */
export function pointInHelp(x: number, y: number): boolean {
  return x >= HELP_RECT.x && x <= HELP_RECT.x + HELP_RECT.w
    && y >= HELP_RECT.y && y <= HELP_RECT.y + HELP_RECT.h
}

/**
 * 某格中心点（粒子爆发等定位用）。
 * @param sq 格号 0-63。
 */
export function squareCenter(sq: number): [number, number] {
  return [BOARD_X + (sq & 7) * CELL + CELL / 2, BOARD_Y + (sq >> 3) * CELL + CELL / 2]
}

/** 画一枚棋子（含王的冠冕标记）。 */
function drawPiece(ctx: CanvasRenderingContext2D, sq: number, piece: Piece): void {
  const [cx, cy] = squareCenter(sq)
  const red = sideOfPiece(piece) === 'r'
  const body = red ? RED_BODY : BLACK_BODY
  const edge = red ? RED_EDGE : BLACK_EDGE
  ctx.beginPath()
  ctx.arc(cx, cy, 22, 0, Math.PI * 2)
  ctx.fillStyle = body
  glow(ctx, body, 6)
  ctx.fill()
  noGlow(ctx)
  ctx.lineWidth = 2.5
  ctx.strokeStyle = edge
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, 15, 0, Math.PI * 2)
  ctx.strokeStyle = edge
  ctx.lineWidth = 1
  ctx.globalAlpha = 0.5
  ctx.stroke()
  ctx.globalAlpha = 1
  if (!isKing(piece)) return
  // 冠冕：底边 + 三个尖角的金色多边形。
  ctx.beginPath()
  ctx.moveTo(cx - 10, cy + 7)
  ctx.lineTo(cx - 10, cy - 2)
  ctx.lineTo(cx - 5, cy + 2)
  ctx.lineTo(cx, cy - 8)
  ctx.lineTo(cx + 5, cy + 2)
  ctx.lineTo(cx + 10, cy - 2)
  ctx.lineTo(cx + 10, cy + 7)
  ctx.closePath()
  ctx.fillStyle = THEME.gold
  glow(ctx, THEME.gold, 5)
  ctx.fill()
  noGlow(ctx)
}

/** 木纹棋盘：整块木底 + 淡纹理线 + 深色格 + 外框。 */
function drawBoard(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = WOOD_LIGHT
  ctx.fillRect(BOARD_X, BOARD_Y, BOARD_SIZE, BOARD_SIZE)
  ctx.strokeStyle = 'rgba(74,50,32,0.18)'
  ctx.lineWidth = 1
  for (let i = 1; i < 16; i += 1) {
    const y = BOARD_Y + (BOARD_SIZE / 16) * i
    ctx.beginPath()
    ctx.moveTo(BOARD_X, y)
    ctx.bezierCurveTo(BOARD_X + 160, y + 5, BOARD_X + 320, y - 5, BOARD_X + BOARD_SIZE, y + 2)
    ctx.stroke()
  }
  ctx.fillStyle = WOOD_DARK
  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      if (((r + c) & 1) !== 1) continue
      ctx.fillRect(BOARD_X + c * CELL, BOARD_Y + r * CELL, CELL, CELL)
    }
  }
  ctx.lineWidth = 3
  ctx.strokeStyle = WOOD_EDGE
  ctx.strokeRect(BOARD_X - 1.5, BOARD_Y - 1.5, BOARD_SIZE + 3, BOARD_SIZE + 3)
}

/** 顶部局分 HUD + 右侧赛制信息（基线 y=26，均在边界内互不重叠）。 */
function drawHud(ctx: CanvasRenderingContext2D, view: DraughtsView): void {
  hudPair(ctx, 16, 26, '局分', '你 ' + view.youWins + ' - ' + view.aiWins + ' AI')
  hudPair(ctx, LOGICAL_W - 16, 26, '3局2胜', '第' + view.round + '局', 'right')
}

/** 底部状态行（左锚 x=16，基线 y=570，与说明按钮区不相交）。 */
function drawStatus(ctx: CanvasRenderingContext2D, view: DraughtsView): void {
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = view.statusColor
  ctx.fillText(view.statusText, 16, 570)
}

/** 说明按钮（60x24，右下角，位于渲染最上层）。 */
function drawHelpButton(ctx: CanvasRenderingContext2D): void {
  roundRectPath(ctx, HELP_RECT.x, HELP_RECT.y, HELP_RECT.w, HELP_RECT.h, 6)
  ctx.fillStyle = THEME.panel
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = THEME.panelEdge
  ctx.stroke()
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = THEME.text
  ctx.fillText('说明', HELP_RECT.x + HELP_RECT.w / 2, HELP_RECT.y + 16)
}

const HELP_LINES: string[] = [
  '目标：吃光对方棋子，或让对方无子可动。',
  '普通子只能沿斜线向前走一格，不能后退。',
  '吃子：跳过相邻敌子落到其后的空格。',
  '连跳必须一口气跳到底，中途不能停。',
  '有吃必吃：存在吃法时必须吃，多选任选。',
  '到达对方底线升王：王可四斜向走与跳。',
  '金框标记上一步；红圈警示必吃的子。',
  'U 悔棋 / R 重开 / P 暂停；3 局 2 胜。',
]

/** 帮助面板：半透明遮罩 + 面板 + 8 行 15px 规则（任何阶段可开合）。 */
function drawHelpPanel(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = 'rgba(13,13,20,0.55)'
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H)
  roundRectPath(ctx, 40, 100, 480, 396, 10)
  ctx.fillStyle = THEME.panel
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = THEME.panelEdge
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.font = 'bold 17px system-ui, sans-serif'
  ctx.fillStyle = THEME.text
  ctx.fillText('玩法说明', LOGICAL_W / 2, 136)
  ctx.font = '15px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = THEME.text
  HELP_LINES.forEach((line, i) => {
    ctx.fillText(line, 64, 174 + i * 28)
  })
  ctx.font = '12px system-ui, sans-serif'
  ctx.fillStyle = THEME.textMuted
  ctx.textAlign = 'center'
  ctx.fillText('点击任意处关闭', LOGICAL_W / 2, 478)
}

/**
 * 渲染一帧：背景 → HUD → 棋盘与标记 → 棋子 → 底部状态 → 遮罩 →
 * 说明按钮 →（打开时）帮助面板（最上层）。
 * @param ctx 已应用逻辑坐标变换的 2d 上下文。
 * @param view 展示状态。
 */
export function renderDraughts(ctx: CanvasRenderingContext2D, view: DraughtsView): void {
  drawBackground(ctx, LOGICAL_W, LOGICAL_H)
  drawHud(ctx, view)
  drawBoard(ctx)
  if (view.lastMove !== null) {
    for (const sq of [view.lastMove.from, view.lastMove.to]) {
      ctx.fillStyle = 'rgba(224,175,104,0.22)'
      ctx.fillRect(BOARD_X + (sq & 7) * CELL, BOARD_Y + (sq >> 3) * CELL, CELL, CELL)
      ctx.lineWidth = 2
      ctx.strokeStyle = THEME.gold
      ctx.strokeRect(BOARD_X + (sq & 7) * CELL + 1, BOARD_Y + (sq >> 3) * CELL + 1, CELL - 2, CELL - 2)
    }
  }
  if (view.selected >= 0) {
    const sq = view.selected
    glow(ctx, accent(0), 8)
    ctx.lineWidth = 3
    ctx.strokeStyle = accent(0)
    ctx.strokeRect(BOARD_X + (sq & 7) * CELL + 2, BOARD_Y + (sq >> 3) * CELL + 2, CELL - 4, CELL - 4)
    noGlow(ctx)
  }
  // 有吃必吃时全部可走点均为吃子落点：画空心的红圈警示，否则画实心蓝点。
  const captureTargets = view.captureFroms.size > 0
  for (const to of view.targets) {
    const [cx, cy] = squareCenter(to)
    ctx.beginPath()
    ctx.arc(cx, cy, captureTargets ? 14 : 7, 0, Math.PI * 2)
    if (captureTargets) {
      ctx.lineWidth = 3
      ctx.strokeStyle = THEME.bad
      ctx.globalAlpha = 0.9
      ctx.stroke()
    } else {
      ctx.fillStyle = accent(0)
      ctx.globalAlpha = 0.85
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }
  if (view.captureFroms.size > 0) {
    for (const sq of view.captureFroms) {
      const [cx, cy] = squareCenter(sq)
      ctx.beginPath()
      ctx.arc(cx, cy, 27, 0, Math.PI * 2)
      ctx.lineWidth = 2.5
      ctx.strokeStyle = THEME.bad
      glow(ctx, THEME.bad, 8)
      ctx.stroke()
      noGlow(ctx)
    }
  }
  for (let sq = 0; sq < 64; sq += 1) {
    const p = view.pos.board[sq]!
    if (p !== '') drawPiece(ctx, sq, p)
  }
  drawStatus(ctx, view)
  if (view.overlay !== null) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, view.overlay.text, view.overlay.sub, view.overlay.color)
  }
  drawHelpButton(ctx)
  if (view.helpOpen) drawHelpPanel(ctx)
}
