/**
 * 翻棋暗战渲染层：木纹棋盘、暗子背面纹样、红黑汉字亮子、
 * 选中与落点提示、翻面动画、局分 HUD、胜负遮罩与「说明」帮助面板。
 * 全部绘制为纯函数，不持有游戏状态。
 */
import { THEME, accent, glow, noGlow, roundRectPath, drawBackground, drawOverlay, hudPair, createParticles } from '../theme.ts'
import type { ParticleSystem } from '../theme.ts'
import { COLS, ROWS, PIECE_CHAR, rowOf, colOf, type BanqiState, type Piece } from './logic.ts'

/** 逻辑画布尺寸。 */
export const LOGICAL_W = 472
export const LOGICAL_H = 320
/** 单格边长。 */
export const CELL = 52
/** 棋盘左上角（棋盘 416×208，水平居中）。 */
export const BOARD_X = 28
export const BOARD_Y = 52

/** 「说明」按钮矩形（渲染在最上层，点击命中由 index.ts 复用本常量）。 */
export const HELP_RECT = { x: LOGICAL_W - 74, y: 8, w: 60, h: 24 }

/** 渲染所需的视图状态（由 index.ts 维护）。 */
export interface BanqiView {
  /** 选中的己方亮子格，null 未选。 */
  selected: number | null
  /** 选中子的合法落点。 */
  targets: number[]
  /** 翻面动画：格 index 与 0→1 进度。 */
  flip: { index: number, progress: number } | null
  /** 局分（三局两胜）。 */
  matchRed: number
  matchBlack: number
  /** 顶部右侧状态短句（右锚显示）。 */
  status: string
  /** 是否分出本局胜负。 */
  winnerLabel: string | null
  /** 暂停中。 */
  paused: boolean
  /** 帮助面板是否展开。 */
  helpOpen: boolean
  /** 粒子系统（由 index 持有，此处只负责按帧推进）。 */
  particles: ParticleSystem
}

/** 帮助面板的八行完整规则。 */
const HELP_LINES: string[] = [
  '4×8 共三十二格，红黑各十六子全部暗扣。',
  '每回合三选一：翻一枚暗子，或走一步己方亮子。',
  '亮子正交一步：进空格，或按等级吃子。',
  '等级：帅>仕>相>车>马>兵；大吃小，同级互吃。',
  '例外：兵可吃帅；帅不可吃兵；炮不入级。',
  '炮只可隔恰好一子跳吃，不能邻近吃子。',
  '无暗子且无子可动或被吃光的一方落败。',
  '三局两胜；R 重开、P 暂停；本说明随时可开合。',
]

function cellRect(index: number): { x: number, y: number } {
  return { x: BOARD_X + colOf(index) * CELL, y: BOARD_Y + rowOf(index) * CELL }
}

/** 木色棋盘格：暖色两档相间 + 内描边。 */
function drawBoard(ctx: CanvasRenderingContext2D): void {
  roundRectPath(ctx, BOARD_X - 10, BOARD_Y - 10, COLS * CELL + 20, ROWS * CELL + 20, 10)
  ctx.fillStyle = '#5a4632'
  ctx.fill()
  ctx.strokeStyle = '#3d2f20'
  ctx.lineWidth = 2
  ctx.stroke()
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#c9a06a' : '#b98d58'
      ctx.fillRect(BOARD_X + c * CELL, BOARD_Y + r * CELL, CELL, CELL)
    }
  }
}

/** 暗子：深色圆角棋子 + 中心菱形纹样。 */
function drawHidden(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const pad = 5
  roundRectPath(ctx, x + pad, y + pad, CELL - pad * 2, CELL - pad * 2, 8)
  ctx.fillStyle = '#33334a'
  ctx.fill()
  ctx.strokeStyle = '#4d4d70'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.save()
  ctx.translate(x + CELL / 2, y + CELL / 2)
  ctx.rotate(Math.PI / 4)
  ctx.strokeStyle = '#6a6a95'
  ctx.strokeRect(-7, -7, 14, 14)
  ctx.restore()
}

/** 亮子：红/黑底圆角棋子 + 居中汉字。 */
function drawRevealed(ctx: CanvasRenderingContext2D, x: number, y: number, piece: Piece): void {
  const pad = 5
  const red = piece.side === 'red'
  roundRectPath(ctx, x + pad, y + pad, CELL - pad * 2, CELL - pad * 2, 8)
  ctx.fillStyle = red ? '#a63d4a' : '#2b2b40'
  ctx.fill()
  glow(ctx, red ? '#f7768e' : '#7dcfff', 5)
  ctx.strokeStyle = red ? '#f7768e' : '#7dcfff'
  ctx.lineWidth = 1.6
  ctx.stroke()
  noGlow(ctx)
  ctx.font = '700 22px "Noto Serif SC", system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = red ? '#ffe4e4' : '#e6f2ff'
  ctx.fillText(PIECE_CHAR[piece.side][piece.type], x + CELL / 2, y + CELL / 2 + 1)
  ctx.textBaseline = 'alphabetic'
}

/** 顶部 HUD：左局分、右状态，均避开「说明」按钮。 */
function drawHud(ctx: CanvasRenderingContext2D, view: BanqiView): void {
  const scoreText = view.matchRed + ' : ' + view.matchBlack
  hudPair(ctx, 14, 24, '局分', scoreText, 'left', THEME.gold)
  const rightEdge = HELP_RECT.x - 10
  hudPair(ctx, rightEdge, 24, view.status, '', 'right')
}

/**
 * 渲染一帧。调用顺序：背景 → HUD → 棋盘棋子 → 状态行 → 粒子 →
 * 胜负遮罩 → 帮助面板与「说明」按钮（最后，最上层）。
 * @param ctx 画布上下文（已套逻辑坐标变换）。
 * @param state 当前局面。
 * @param view 视图状态。
 * @param dtMs 距上帧毫秒（推进粒子）。
 */
export function renderBanqi(ctx: CanvasRenderingContext2D, state: BanqiState, view: BanqiView, dtMs: number): void {
  drawBackground(ctx, LOGICAL_W, LOGICAL_H)
  drawHud(ctx, view)
  drawBoard(ctx)

  for (let i = 0; i < state.board.length; i += 1) {
    const piece = state.board[i]
    if (piece == null) continue
    const { x, y } = cellRect(i)
    if (view.flip !== null && view.flip.index === i) {
      // 翻面动画：水平缩放从背面过渡到正面。
      const t = Math.min(1, Math.max(0, view.flip.progress))
      const scaleX = Math.abs(Math.cos(t * Math.PI))
      if (scaleX > 0.04) {
        ctx.save()
        ctx.translate(x + CELL / 2, y)
        ctx.scale(scaleX, 1)
        ctx.translate(-(x + CELL / 2), -y)
        if (t < 0.5) drawHidden(ctx, x, y)
        else drawRevealed(ctx, x, y, piece)
        ctx.restore()
      }
      continue
    }
    if (piece.revealed) drawRevealed(ctx, x, y, piece)
    else drawHidden(ctx, x, y)
  }

  if (view.selected !== null) {
    const { x, y } = cellRect(view.selected)
    glow(ctx, accent(0), 10)
    roundRectPath(ctx, x + 4, y + 4, CELL - 8, CELL - 8, 8)
    ctx.strokeStyle = accent(0)
    ctx.lineWidth = 2.4
    ctx.stroke()
    noGlow(ctx)
  }
  for (const t of view.targets) {
    const { x, y } = cellRect(t)
    ctx.beginPath()
    if (state.board[t] === null) {
      ctx.fillStyle = 'rgba(122,162,247,0.85)'
      ctx.arc(x + CELL / 2, y + CELL / 2, 6, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.strokeStyle = '#9ece6a'
      ctx.lineWidth = 3
      ctx.arc(x + CELL / 2, y + CELL / 2, CELL / 2 - 6, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = THEME.textMuted
  const hint = view.paused ? '暂停中——按 P 继续' : (view.winnerLabel !== null ? view.winnerLabel + '　点击棋盘开始下一局' : (view.status === '红方行棋' ? '点暗子翻开 · 点亮子选走' : '黑方思考中……'))
  ctx.fillText(hint, LOGICAL_W / 2, 288)

  view.particles.tick(ctx, dtMs)

  if (view.paused) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '暂停', '按 P 继续 · R 重开整场')
  } else if (view.winnerLabel !== null) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, view.winnerLabel, '三局两胜 · 点击棋盘进入下一局')
  }

  if (view.helpOpen) {
    ctx.fillStyle = 'rgba(13,13,20,0.82)'
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H)
    roundRectPath(ctx, 36, 44, 400, 256, 12)
    ctx.fillStyle = THEME.panel
    ctx.fill()
    ctx.strokeStyle = THEME.panelEdge
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.font = 'bold 17px system-ui, sans-serif'
    ctx.fillStyle = THEME.text
    ctx.fillText('翻棋暗战 · 规则说明', LOGICAL_W / 2, 74)
    ctx.font = '600 15px system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillStyle = THEME.text
    for (let i = 0; i < HELP_LINES.length; i += 1) {
      ctx.fillText(HELP_LINES[i]!, 58, 104 + i * 26)
    }
  }

  // 「说明」按钮永远画在最后一层，保证任何阶段可见可点。
  roundRectPath(ctx, HELP_RECT.x, HELP_RECT.y, HELP_RECT.w, HELP_RECT.h, 6)
  ctx.fillStyle = view.helpOpen ? accent(0) : THEME.panel
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = view.helpOpen ? '#15151b' : THEME.text
  ctx.fillText('说明', HELP_RECT.x + HELP_RECT.w / 2, HELP_RECT.y + 16)
}
