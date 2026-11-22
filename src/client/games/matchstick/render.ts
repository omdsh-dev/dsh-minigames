/**
 * 火柴算式渲染与命中：木纹桌面、七段火柴（红头木身、悬停高亮、选中
 * 抬起）、可放置空位提示、步数/题号/倒计时 HUD 与过关遮罩。全部为纯
 * canvas 绘制与几何换算（无 DOM、无状态），命中函数与绘制共用同一套
 * 段矩形几何，保证点哪是哪。
 */
import { THEME, accent, drawBackground, drawOverlay, glow, hudPair, noGlow, roundRectPath } from '../theme.ts'
import { addableSegs, glyphBits, type MatchstickState, type Seg } from './logic.ts'

/** 逻辑画布尺寸。 */
export const W = 720
export const H = 430

/** 等式区上边距与字格高度。 */
const EQ_Y0 = 86
const EQ_H = 110
/** 等式区左右最小边距。 */
const EQ_MARGIN = 24
/** 字格水平间距。 */
const CELL_GAP = 14
/** 火柴基础粗细（按字格宽度收缩）。 */
const STICK_T = 8

/** 字格布局结果：每格左上角 x、格宽与段矩形几何参数。 */
export interface CellLayout {
  xs: number[]
  cw: number
  ch: number
  t: number
}

/**
 * 计算 n 格等式的居中布局：字格宽度按总宽自适应（不超过基准宽），
 * 整体在 [EQ_MARGIN, W-EQ_MARGIN] 内水平居中。
 * @param n - 字格总数。
 */
export function layoutCells(n: number): CellLayout {
  const usable = W - EQ_MARGIN * 2 - CELL_GAP * (n - 1)
  const cw = Math.max(20, Math.min(56, Math.floor(usable / n)))
  const total = cw * n + CELL_GAP * (n - 1)
  const x0 = Math.floor((W - total) / 2)
  const xs: number[] = []
  for (let i = 0; i < n; i += 1) xs.push(x0 + i * (cw + CELL_GAP))
  return { xs, cw, ch: EQ_H, t: Math.max(5, Math.min(STICK_T, Math.round(cw * 0.16))) }
}

/**
 * 某格某段的火柴矩形（含中心线几何：横段贴 y 行、竖段贴 x 列）。
 * @param layout - 布局。
 * @param cell - 格下标。
 * @param seg - 段名。
 */
export function segRect(layout: CellLayout, cell: number, seg: Seg): { x: number, y: number, w: number, h: number } {
  const { xs, cw, ch, t } = layout
  const cx = xs[cell]!
  const inset = Math.round(t * 0.8)
  const half = ch / 2
  switch (seg) {
    case 'a': return { x: cx + inset, y: EQ_Y0, w: cw - inset * 2, h: t }
    case 'g': return { x: cx + inset, y: EQ_Y0 + half, w: cw - inset * 2, h: t }
    case 'd': return { x: cx + inset, y: EQ_Y0 + ch, w: cw - inset * 2, h: t }
    case 'x': return { x: cx + Math.round(cw * 0.25), y: EQ_Y0 + ch * 0.6, w: cw * 0.5, h: t }
    case 'y': return { x: cx + Math.round(cw * 0.25), y: EQ_Y0 + ch * 0.85, w: cw * 0.5, h: t }
    case 'f': return { x: cx, y: EQ_Y0 + t / 2, w: t, h: half - t }
    case 'b': return { x: cx + cw - t, y: EQ_Y0 + t / 2, w: t, h: half - t }
    case 'e': return { x: cx, y: EQ_Y0 + half + t / 2, w: t, h: half - t }
    case 'c': return { x: cx + cw - t, y: EQ_Y0 + half + t / 2, w: t, h: half - t }
    case 'm': return { x: cx + (cw - t) / 2, y: EQ_Y0 + t / 2, w: t, h: half - t }
    case 'n': return { x: cx + (cw - t) / 2, y: EQ_Y0 + half + t / 2, w: t, h: half - t }
  }
}

/** 命中容差（逻辑像素）。 */
const HIT_PAD = 6

/**
 * 命中某根在场火柴（按矩形外扩 HIT_PAD 判定）。
 * @param cells - 题面字元序列。
 * @param x - 逻辑坐标 x。
 * @param y - 逻辑坐标 y。
 * @returns 命中的 {cell, seg}；未命中返回 null。
 */
export function hitStick(cells: string, x: number, y: number): { cell: number, seg: Seg } | null {
  const layout = layoutCells(cells.length)
  const segs: Seg[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'm', 'n', 'x', 'y']
  for (let i = 0; i < cells.length; i += 1) {
    const bits = glyphBits(cells[i]!)
    for (const seg of segs) {
      if ((bits & (1 << segs.indexOf(seg))) === 0) continue
      const r = segRect(layout, i, seg)
      if (x >= r.x - HIT_PAD && x <= r.x + r.w + HIT_PAD && y >= r.y - HIT_PAD && y <= r.y + r.h + HIT_PAD) {
        return { cell: i, seg }
      }
    }
  }
  return null
}

/**
 * 命中一个可放置空位（该格该段当前为空且补后仍是合法字型）。
 * @param cells - 题面字元序列。
 * @param x - 逻辑坐标 x。
 * @param y - 逻辑坐标 y。
 * @returns 命中的 {cell, seg}；未命中返回 null。
 */
export function hitSlot(cells: string, x: number, y: number): { cell: number, seg: Seg } | null {
  const layout = layoutCells(cells.length)
  for (let i = 0; i < cells.length; i += 1) {
    for (const seg of addableSegs(cells[i]!)) {
      const r = segRect(layout, i, seg)
      if (x >= r.x - HIT_PAD && x <= r.x + r.w + HIT_PAD && y >= r.y - HIT_PAD && y <= r.y + r.h + HIT_PAD) {
        return { cell: i, seg }
      }
    }
  }
  return null
}

/** 备用匣矩形（取新火柴 / 丢弃手中火柴）。 */
const TRAY = { x: W / 2 - 118, y: 316, w: 236, h: 70 }

/**
 * 命中备用匣。
 * @param x - 逻辑坐标 x。
 * @param y - 逻辑坐标 y。
 */
export function hitTray(x: number, y: number): boolean {
  return x >= TRAY.x && x <= TRAY.x + TRAY.w && y >= TRAY.y && y <= TRAY.y + TRAY.h
}

/** 火柴配色。 */
const WOOD = '#d9b380'
const WOOD_LIT = '#f2d29b'
const HEAD = '#e0554a'

/**
 * 画一根火柴：圆角木身 + 一端红色火柴头；悬停/选中时提亮并加辉光，
 * 选中额外向上抬起 6px。
 * @param ctx - 画布上下文。
 * @param rect - 段矩形。
 * @param vertical - 是否竖段（火柴头朝下端）。
 * @param stateLit - 提亮（悬停或选中）。
 * @param lift - 抬起像素（选中）。
 */
function drawStick(ctx: CanvasRenderingContext2D, rect: { x: number, y: number, w: number, h: number }, vertical: boolean, stateLit: boolean, lift: number): void {
  const x = rect.x
  const y = rect.y - lift
  ctx.fillStyle = stateLit ? WOOD_LIT : WOOD
  if (stateLit) glow(ctx, accent(4), 10)
  roundRectPath(ctx, x, y, rect.w, rect.h, Math.min(rect.w, rect.h) / 2)
  ctx.fill()
  noGlow(ctx)
  const hr = Math.min(rect.w, rect.h) * 0.62
  ctx.fillStyle = HEAD
  if (stateLit) glow(ctx, HEAD, 8)
  ctx.beginPath()
  ctx.arc(
    vertical ? x + rect.w / 2 : (rect.w > rect.h ? x + rect.w - hr : x + rect.w / 2),
    vertical ? y + rect.h - hr : y + rect.h / 2,
    hr, 0, Math.PI * 2,
  )
  ctx.fill()
  noGlow(ctx)
}

/** 渲染视图参数。 */
export interface MatchstickView {
  state: MatchstickState
  paused: boolean
  /** 悬停火柴（来自 pointermove 命中）。 */
  hover: { cell: number, seg: Seg } | null
  /** 「不成立，已还原」闪红剩余秒数。 */
  flashWrong: number
  /** 解题成功闪绿剩余秒数。 */
  flashRight: number
}

/**
 * 整帧绘制：背景、木纹桌面、等式火柴、空位提示、HUD、备用匣与
 * 遮罩。绘制只读 view，不产生副作用。
 * @param ctx - 画布上下文。
 * @param view - 渲染视图。
 */
export function renderMatchstick(ctx: CanvasRenderingContext2D, view: MatchstickView): void {
  const { state } = view
  drawBackground(ctx, W, H)

  // 木纹桌面
  ctx.fillStyle = '#4a3a28'
  roundRectPath(ctx, 16, 70, W - 32, 152, 12)
  ctx.fill()
  ctx.strokeStyle = '#6a5236'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.strokeStyle = 'rgba(0,0,0,0.16)'
  ctx.lineWidth = 1
  for (let i = 1; i <= 4; i += 1) {
    const gy = 70 + 152 * (i / 5)
    ctx.beginPath()
    ctx.moveTo(30, gy)
    ctx.lineTo(W - 30, gy + (i % 2 === 0 ? 3 : -3))
    ctx.stroke()
  }

  // HUD：左列 关卡/题/步，中间 分数，右锚 倒计时（动态数字右锚不越界）
  hudPair(ctx, 16, 24, '关卡', String(state.level + 1) + '/5')
  hudPair(ctx, 118, 24, '题', String(state.puzzleIndex + 1) + '/5')
  hudPair(ctx, 214, 24, '步', String(state.attempts))
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('分数', W / 2 - 16, 24)
  ctx.fillStyle = THEME.gold
  ctx.fillText(String(state.score), W / 2 + 22, 24)
  const tl = Math.ceil(state.timeLeft)
  hudPair(ctx, W - 16, 24, '倒计时', tl + 's', 'right', tl <= 10 ? THEME.bad : THEME.text)

  // 常驻速览一行
  ctx.font = '500 12px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('点火柴拿起 · 点空位放下 · 后期可从匣中取新柴或抽走丢弃 · U 放回 · R 重开 · P 暂停', W / 2, 48)

  // 等式火柴与空位提示
  const cells = state.cells
  const layout = layoutCells(cells.length)
  const held = state.held
  if (held !== null) {
    for (let i = 0; i < cells.length; i += 1) {
      for (const seg of addableSegs(cells[i]!)) {
        const r = segRect(layout, i, seg)
        ctx.fillStyle = 'rgba(255,255,255,0.13)'
        roundRectPath(ctx, r.x + 1, r.y + 1, r.w - 2, r.h - 2, 2)
        ctx.fill()
      }
    }
  }
  const segs: Seg[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'm', 'n', 'x', 'y']
  for (let i = 0; i < cells.length; i += 1) {
    const bits = glyphBits(cells[i]!)
    for (let si = 0; si < segs.length; si += 1) {
      const seg = segs[si]!
      if ((bits & (1 << si)) === 0) continue
      const r = segRect(layout, i, seg)
      const vertical = r.h > r.w
      const isHeld = held !== null && held.from === 'board' && held.cell === i && held.seg === seg
      const isHover = view.hover !== null && view.hover.cell === i && view.hover.seg === seg
      drawStick(ctx, r, vertical, isHeld || isHover, isHeld ? 6 : 0)
    }
  }

  // 修法与判定提示行
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  const fixText = state.fix === 'move' ? '本题主线：移动一根' : state.fix === 'add' ? '本题主线：补上一根' : '本题主线：抽走一根'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText(fixText, W / 2, 250)
  if (view.flashWrong > 0) {
    ctx.fillStyle = THEME.bad
    ctx.fillText('✗ 不成立，已还原', W / 2, 274)
  } else if (view.flashRight > 0) {
    ctx.fillStyle = THEME.good
    ctx.fillText('✓ 成立！', W / 2, 274)
  }

  // 备用匣：可取新柴（拿起状态提示），手持棋盘火柴时点击=丢弃
  ctx.fillStyle = THEME.panel
  roundRectPath(ctx, TRAY.x, TRAY.y, TRAY.w, TRAY.h, 10)
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.stroke()
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = THEME.text
  ctx.fillText('备用火柴匣', W / 2, TRAY.y + 24)
  ctx.font = '500 11px system-ui, sans-serif'
  ctx.fillStyle = THEME.textMuted
  const trayTip = held !== null && held.from === 'board'
    ? '点此丢弃手中火柴（抽走一根）'
    : held !== null ? '手中已有火柴' : '点此取一根新柴（补一根）'
  ctx.fillText(trayTip, W / 2, TRAY.y + 44)
  if (held === null || held.from === 'board') {
    drawStick(ctx, { x: W / 2 - 22, y: TRAY.y + 52, w: 44, h: 6 }, false, false, 0)
  }

  if (state.status === 'won') {
    drawOverlay(ctx, W, H, '全部过关', '总分 ' + String(state.score) + ' · 解出 ' + String(state.solved) + '/25', THEME.gold)
  } else if (view.paused) {
    drawOverlay(ctx, W, H, '暂停', '按 P 或点画布继续')
  }
}
