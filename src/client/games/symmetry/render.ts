/**
 * 对称补全 Symmetry 渲染层：方格纸盘面、左半彩色图形、金色对称轴虚线、
 * 构件盘（选中态 + 拖放提示）、对位绿显 / 错位红显、步数与限时 HUD、
 * 选择题与轮次通过闪亮。纯绘制，无状态；布局常量集中声明并核算互不
 * 遮挡（HUD 行 y26、速览行 y48、盘面 60-432、题面 104-368、选项行
 * 388-430、构件盘 444-536，均在 720x560 逻辑画布内）。
 */
import type { AxisKind, Cell, Piece, PieceKind, Round } from './logic.ts'
import { accent, drawBackground, glow, hudPair, noGlow, roundRectPath, THEME } from '../theme.ts'

/** 逻辑画布尺寸。 */
export const LOGICAL_W = 720
export const LOGICAL_H = 560

/** 矩形区域（逻辑坐标）。 */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** 网格盘面布局：左上角与单元边长（含居中边距）。 */
export interface Layout {
  ox: number
  oy: number
  cell: number
}

const BOARD_AREA: Rect = { x: 16, y: 60, w: 688, h: 372 }
const QUIZ_AREA: Rect = { x: 16, y: 104, w: 688, h: 264 }
const TRAY: Rect = { x: 16, y: 444, w: 688, h: 92 }
const TRAY_SLOT = 60
const TRAY_GAP = 8
const OPTION_W = 120
const OPTION_H = 42
const OPTION_GAP = 16
const OPTION_Y = 388

/**
 * 在区域内为 grid x grid 网格求自适应布局（单元取整、整体居中含边距）。
 * @param area - 允许占用的矩形区域。
 * @param grid - 网格边长。
 * @returns 布局。
 */
export function layoutFor(area: Rect, grid: number): Layout {
  const cell = Math.floor(Math.min(area.w / grid, area.h / grid))
  return {
    ox: area.x + (area.w - cell * grid) / 2,
    oy: area.y + (area.h - cell * grid) / 2,
    cell,
  }
}

/**
 * 拼图回合盘面布局。
 * @param grid - 网格边长。
 * @returns 布局。
 */
export function boardLayout(grid: number): Layout {
  return layoutFor(BOARD_AREA, grid)
}

/**
 * 选择题图形布局。
 * @param grid - 网格边长。
 * @returns 布局。
 */
export function quizLayout(grid: number): Layout {
  return layoutFor(QUIZ_AREA, grid)
}

/**
 * 单元中心点（逻辑坐标）。
 * @param layout - 盘面布局。
 * @param c - 网格单元。
 * @returns 中心坐标。
 */
export function cellCenter(layout: Layout, c: Cell): { x: number; y: number } {
  return { x: layout.ox + (c.x + 0.5) * layout.cell, y: layout.oy + (c.y + 0.5) * layout.cell }
}

function pointInRect(r: Rect, px: number, py: number): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h
}

/**
 * 命中测试：把逻辑坐标四舍五入到最近网格单元（即半格吸附容差），越界
 * 返回 null。
 * @param layout - 盘面布局。
 * @param grid - 网格边长。
 * @param px - 逻辑 x。
 * @param py - 逻辑 y。
 * @returns 命中的网格单元，或 null。
 */
export function cellFromPoint(layout: Layout, grid: number, px: number, py: number): Cell | null {
  const gx = Math.floor((px - layout.ox) / layout.cell)
  const gy = Math.floor((py - layout.oy) / layout.cell)
  if (gx < 0 || gy < 0 || gx >= grid || gy >= grid) return null
  return { x: gx, y: gy }
}

/**
 * 构件盘第 i 个槽位的矩形（按剩余构件数整行居中）。
 * @param i - 槽位下标。
 * @param count - 当前构件总数。
 * @returns 槽位矩形。
 */
export function paletteSlotRect(i: number, count: number): Rect {
  const total = count * TRAY_SLOT + (count - 1) * TRAY_GAP
  const x0 = TRAY.x + (TRAY.w - total) / 2
  return { x: x0 + i * (TRAY_SLOT + TRAY_GAP), y: 458, w: TRAY_SLOT, h: TRAY_SLOT }
}

/**
 * 构件盘命中测试。
 * @param count - 当前构件总数。
 * @param px - 逻辑 x。
 * @param py - 逻辑 y。
 * @returns 槽位下标，未命中返回 -1。
 */
export function paletteSlotAt(count: number, px: number, py: number): number {
  for (let i = 0; i < count; i += 1) {
    if (pointInRect(paletteSlotRect(i, count), px, py)) return i
  }
  return -1
}

/**
 * 选择题第 i 个选项按钮矩形（4 个按钮整行居中，总宽 528）。
 * @param i - 选项下标。
 * @returns 按钮矩形。
 */
export function quizOptionRect(i: number): Rect {
  const total = 4 * OPTION_W + 3 * OPTION_GAP
  return { x: (LOGICAL_W - total) / 2 + i * (OPTION_W + OPTION_GAP), y: OPTION_Y, w: OPTION_W, h: OPTION_H }
}

/**
 * 选择题按钮命中测试。
 * @param px - 逻辑 x。
 * @param py - 逻辑 y。
 * @returns 选项下标，未命中返回 -1。
 */
export function quizOptionAt(px: number, py: number): number {
  for (let i = 0; i < 4; i += 1) {
    if (pointInRect(quizOptionRect(i), px, py)) return i
  }
  return -1
}

/** 已放置构件的可绘制视图（单元为绝对网格单元）。 */
export interface PieceView {
  /** 稳定色相索引（从构件盘到落位颜色一致，不随槽位洗牌漂移）。 */
  hue: number
  kind: PieceKind
  cells: Cell[]
}

/** 一帧的完整绘制视图（index 层组装）。 */
export interface SceneView {
  round: Round
  /** 拼图回合：已正确补上的构件（绿色）。 */
  placedCorrect: PieceView[]
  /** 拼图回合：错放的构件（红色，可取回）。 */
  wrong: PieceView[]
  /** 构件盘当前剩余的构件（已补上的从盘中移除）。 */
  palette: Piece[]
  /** 构件盘每个构件的稳定色相索引（与 palette 平行）。 */
  paletteHues: number[]
  /** 构件盘选中下标，-1 未选。 */
  selected: number
  /** 选择题已点选项下标，-1 未点。 */
  quizPicked: number
  /** HUD 左侧值（如 '3/5 · 轮 2/3'）。 */
  hudLevel: string
  /** 步数。 */
  steps: number
  /** 剩余秒数。 */
  secondsLeft: number
  /** 轮次通过亮度脉冲 0-1。 */
  flash: number
}

function cellRect(layout: Layout, c: Cell): { x: number; y: number } {
  return { x: layout.ox + c.x * layout.cell, y: layout.oy + c.y * layout.cell }
}

/**
 * 画一个构件（按类型）：block 实心圆角块 / line 粗线段 / arc 过拐角的
 * 四分之一弧。绘制只依赖单元集合，因此对镜像自动成立。
 * @param ctx - 画布上下文。
 * @param layout - 盘面布局。
 * @param kind - 构件类型。
 * @param cells - 绝对单元集合。
 * @param color - 主色。
 * @param lit - 是否加发光（对位绿显 / 错位红显）。
 */
function drawPieceCells(
  ctx: CanvasRenderingContext2D, layout: Layout, kind: PieceKind, cells: Cell[], color: string, lit: boolean,
): void {
  const s = layout.cell
  if (lit) glow(ctx, color, 12)
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (kind === 'block') {
    for (const c of cells) {
      const p = cellRect(layout, c)
      roundRectPath(ctx, p.x + 2, p.y + 2, s - 4, s - 4, Math.max(2, s * 0.16))
      ctx.fill()
    }
  } else if (kind === 'line') {
    const sorted = cells.slice().sort((a, b) => a.y - b.y || a.x - b.x)
    const a = cellCenter(layout, sorted[0]!)
    const b = cellCenter(layout, sorted[sorted.length - 1]!)
    ctx.lineWidth = s * 0.26
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  } else {
    // L 形足迹：拐角单元与两端单元；二次曲线模拟四分之一弧。
    const sorted = cells.slice().sort((a, b) => a.y - b.y || a.x - b.x)
    let corner = sorted[0]!
    let ends: Cell[] = []
    for (const cand of sorted) {
      const others = sorted.filter((c) => c !== cand)
      if (others.every((c) => Math.abs(c.x - cand.x) <= 1 && Math.abs(c.y - cand.y) <= 1)) {
        corner = cand
        ends = others
        break
      }
    }
    const a = cellCenter(layout, ends[0] ?? corner)
    const b = cellCenter(layout, ends[1] ?? corner)
    const ctl = cellCenter(layout, corner)
    ctx.lineWidth = s * 0.2
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.quadraticCurveTo(ctl.x * 2 - (a.x + b.x) / 2, ctl.y * 2 - (a.y + b.y) / 2, b.x, b.y)
    ctx.stroke()
  }
  noGlow(ctx)
}

/**
 * 画对称轴虚线（金色，过网格中心）。
 * @param ctx - 画布上下文。
 * @param layout - 盘面布局。
 * @param grid - 网格边长。
 * @param axis - 对称轴方向。
 */
function drawAxis(ctx: CanvasRenderingContext2D, layout: Layout, grid: number, axis: AxisKind): void {
  const s = layout.cell
  ctx.save()
  ctx.strokeStyle = THEME.gold
  ctx.lineWidth = 2.5
  ctx.setLineDash([9, 7])
  ctx.beginPath()
  if (axis === 'v') {
    const x = layout.ox + (grid / 2) * s
    ctx.moveTo(x, layout.oy)
    ctx.lineTo(x, layout.oy + grid * s)
  } else if (axis === 'h') {
    const y = layout.oy + (grid / 2) * s
    ctx.moveTo(layout.ox, y)
    ctx.lineTo(layout.ox + grid * s, y)
  } else {
    const a = cellCenter(layout, axis === 'd1' ? { x: 0, y: 0 } : { x: grid - 1, y: 0 })
    const b = cellCenter(layout, axis === 'd1' ? { x: grid - 1, y: grid - 1 } : { x: 0, y: grid - 1 })
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
  }
  ctx.stroke()
  ctx.restore()
}

/**
 * 画方格纸底（浅色网格线 + 边框）。
 * @param ctx - 画布上下文。
 * @param layout - 盘面布局。
 * @param grid - 网格边长。
 */
function drawGridPaper(ctx: CanvasRenderingContext2D, layout: Layout, grid: number): void {
  const s = layout.cell
  ctx.strokeStyle = 'rgba(226,226,238,0.08)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i <= grid; i += 1) {
    ctx.moveTo(layout.ox + i * s, layout.oy)
    ctx.lineTo(layout.ox + i * s, layout.oy + grid * s)
    ctx.moveTo(layout.ox, layout.oy + i * s)
    ctx.lineTo(layout.ox + grid * s, layout.oy + i * s)
  }
  ctx.stroke()
  ctx.strokeStyle = 'rgba(226,226,238,0.2)'
  ctx.strokeRect(layout.ox, layout.oy, grid * s, grid * s)
}

function drawPreview(ctx: CanvasRenderingContext2D, rect: Rect, piece: Piece, color: string): void {
  const sorted = piece.cells.slice().sort((a, b) => a.y - b.y || a.x - b.x)
  let minX = sorted[0]!.x
  let minY = sorted[0]!.y
  let maxX = minX
  let maxY = minY
  for (const c of sorted) {
    minX = Math.min(minX, c.x)
    minY = Math.min(minY, c.y)
    maxX = Math.max(maxX, c.x)
    maxY = Math.max(maxY, c.y)
  }
  const spanX = maxX - minX + 1
  const spanY = maxY - minY + 1
  const unit = Math.min(16, Math.floor(Math.min((rect.w - 12) / spanX, (rect.h - 12) / spanY)))
  const layout: Layout = {
    ox: rect.x + (rect.w - unit * spanX) / 2 - minX * unit,
    oy: rect.y + (rect.h - unit * spanY) / 2 - minY * unit,
    cell: unit,
  }
  drawPieceCells(ctx, layout, piece.kind, piece.cells, color, false)
}

function clockText(secondsLeft: number): string {
  const s = Math.max(0, Math.ceil(secondsLeft))
  const m = Math.floor(s / 60)
  return m + ':' + String(s % 60).padStart(2, '0')
}

/**
 * 整帧绘制：背景 + HUD + 常驻速览 + 当前回合 + 闪亮脉冲。overlay 由
 * index 层随后叠加。
 * @param ctx - 画布上下文。
 * @param view - 本帧视图。
 */
/** 说明按钮矩形（右下角）。 */
export const HELP_BTN = { x: LOGICAL_W - 76, y: LOGICAL_H - 34, w: 60, h: 26 }
/** 帮助面板矩形。 */
const HELP_PANEL = { x: LOGICAL_W / 2 - 280, y: LOGICAL_H - 216, w: 560, h: 196 }
/** 帮助面板文案。 */
const HELP_LINES = [
  '玩法速览',
  '· 点构件盘选中，再点缺失侧网格放置；完全镜像才对位锁定',
  '· 无需旋转：盘内构件已是镜像形状，选对件放对位置即可',
  '· 颜色不影响判定：同色=原件与镜像的对应提示，只看形状与位置',
  '· 错放红显：右键或再次点击取回重放；轴上已给构件无需补',
  '· 第 4-5 关对称轴转为 45° 斜线，并混入对称轴计数选择题',
  '· 每关限时 4 分钟且计步：步少时短分高；超时判负可 R 重开',
  '· 过关自动进下一关，进度自动保存 · P 暂停 · 再点「说明」关闭',
]

export function renderScene(ctx: CanvasRenderingContext2D, view: SceneView, helpOpen = false): void {
  drawBackground(ctx, LOGICAL_W, LOGICAL_H)

  // HUD 行（y=26 基线）：左侧关卡/轮次，右侧步数与限时（均右锚定宽）。
  hudPair(ctx, 16, 26, '关卡', view.hudLevel)
  hudPair(ctx, 568, 26, '步数', String(view.steps), 'right')
  const urgent = view.secondsLeft <= 30
  hudPair(ctx, 704, 26, '时间', clockText(view.secondsLeft), 'right', urgent ? THEME.bad : THEME.text)

  if (view.round.type === 'place') {
    const round = view.round
    const layout = boardLayout(round.grid)
    drawGridPaper(ctx, layout, round.grid)
    drawAxis(ctx, layout, round.grid, round.axis)
    round.given.forEach((piece, i) => {
      drawPieceCells(ctx, layout, piece.kind, piece.cells, accent(i), false)
    })
    for (const p of view.wrong) drawPieceCells(ctx, layout, p.kind, p.cells, THEME.bad, true)
    // 已放对的构件保留自身颜色（与构件盘一致——原先统一涂绿导致「放置的颜色
    // 不对/分不清是哪个件」），绿光仅作为正确性提示。
    for (const p of view.placedCorrect) drawPieceCells(ctx, layout, p.kind, p.cells, accent(p.hue), true)

    // 构件盘（底部圆角面板，槽位整行居中）。
    ctx.fillStyle = THEME.panel
    roundRectPath(ctx, TRAY.x, TRAY.y, TRAY.w, TRAY.h, 12)
    ctx.fill()
    ctx.strokeStyle = THEME.panelEdge
    ctx.stroke()
    view.palette.forEach((piece, i) => {
      const hue = view.paletteHues[i] ?? i
      const r = paletteSlotRect(i, view.palette.length)
      roundRectPath(ctx, r.x, r.y, r.w, r.h, 8)
      ctx.fillStyle = 'rgba(226,226,238,0.05)'
      ctx.fill()
      const active = i === view.selected
      ctx.strokeStyle = active ? THEME.accents[0]! : THEME.panelEdge
      ctx.lineWidth = active ? 2 : 1
      ctx.stroke()
      drawPreview(ctx, r, piece, accent(hue))
      if (active) {
        ctx.font = '600 10px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillStyle = THEME.accents[0]!
        ctx.fillText('点盘面放置', r.x + r.w / 2, r.y + r.h + 14)
      }
    })
  } else {
    const round = view.round
    const layout = quizLayout(round.grid)
    drawGridPaper(ctx, layout, round.grid)
    ctx.textAlign = 'center'
    ctx.font = 'bold 16px system-ui, sans-serif'
    ctx.fillStyle = THEME.text
    ctx.fillText('这个图形有几条对称轴？', LOGICAL_W / 2, 88)
    const sorted = round.figure.slice().sort((a, b) => a.y - b.y || a.x - b.x)
    sorted.forEach((c) => {
      const p = cellRect(layout, c)
      roundRectPath(ctx, p.x + 2, p.y + 2, layout.cell - 4, layout.cell - 4, Math.max(2, layout.cell * 0.16))
      ctx.fillStyle = accent(1)
      ctx.fill()
    })
    round.options.forEach((opt, i) => {
      const r = quizOptionRect(i)
      roundRectPath(ctx, r.x, r.y, r.w, r.h, 10)
      const picked = view.quizPicked === i
      if (picked) {
        const ok = i === round.answer
        ctx.fillStyle = ok ? 'rgba(158,206,106,0.25)' : 'rgba(247,118,142,0.25)'
        ctx.fill()
        ctx.strokeStyle = ok ? THEME.good : THEME.bad
      } else {
        ctx.fillStyle = THEME.panel
        ctx.fill()
        ctx.strokeStyle = THEME.panelEdge
      }
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.font = '600 15px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillStyle = THEME.text
      ctx.fillText(String(opt) + ' 条', r.x + r.w / 2, r.y + 27)
    })
  }

  // 轮次通过：两半合亮脉冲。
  if (view.flash > 0) {
    ctx.fillStyle = 'rgba(158,206,106,' + (view.flash * 0.22).toFixed(3) + ')'
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H)
  }

  // 说明按钮（替代常驻小字速览）。
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
    ctx.fillStyle = 'rgba(13,13,20,0.92)'
    roundRectPath(ctx, HELP_PANEL.x, HELP_PANEL.y, HELP_PANEL.w, HELP_PANEL.h, 10)
    ctx.fill()
    ctx.strokeStyle = THEME.panelEdge
    ctx.stroke()
    ctx.textAlign = 'left'
    ctx.font = '600 15px system-ui, sans-serif'
    HELP_LINES.forEach((line, i) => {
      ctx.fillStyle = i === 0 ? accent(2) : THEME.text
      ctx.fillText(line, HELP_PANEL.x + 14, HELP_PANEL.y + 26 + i * 24)
    })
  }

}
