/**
 * 像素画家 PixelPainter 渲染层：左侧参考图（带格线）+ 右侧画布（涂对
 * 微亮 / 涂错红框）+ 底部调色板色块（选中高亮）+ 顶部 HUD（关卡/提示/
 * 步数/错格/完成度，右锚定防错位）+ 说明按钮与帮助面板（drawHelp 由
 * index 层在渲染函数最末调用，覆盖一切 overlay）。纯绘制无状态；布局
 * 常量集中声明：HUD 行基线 y26（左 16/150 起、右 500/596/704 右锚），
 * 图区标签基线 y60，左右面板 70-430，调色板托盘 442-526，操作提示基线
 * y548，说明按钮 644-704 x 532-556，帮助面板 90-630 x 110-430，均在
 * 720x560 逻辑画布内互不重叠。
 */
import type { Cell } from './logic.ts'
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

/** 左侧参考图面板区域。 */
export const LEFT_PANEL: Rect = { x: 16, y: 70, w: 328, h: 360 }
/** 右侧画布面板区域。 */
export const RIGHT_PANEL: Rect = { x: 376, y: 70, w: 328, h: 360 }
/** 底部调色板托盘。 */
const TRAY: Rect = { x: 16, y: 442, w: 688, h: 84 }
/** 调色板色块尺寸与间距。 */
const SWATCH = 46
const SWATCH_GAP = 12
const SWATCH_Y = 460

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
 * 命中测试：把逻辑坐标换算为网格单元，越界返回 null。
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
 * 调色板第 i 个色块矩形（按色数整行居中）。
 * @param i - 色块下标。
 * @param count - 色块总数。
 * @returns 色块矩形。
 */
export function paletteSwatchRect(i: number, count: number): Rect {
  const total = count * SWATCH + (count - 1) * SWATCH_GAP
  const x0 = TRAY.x + (TRAY.w - total) / 2
  return { x: x0 + i * (SWATCH + SWATCH_GAP), y: SWATCH_Y, w: SWATCH, h: SWATCH }
}

/**
 * 调色板命中测试。
 * @param count - 色块总数。
 * @param px - 逻辑 x。
 * @param py - 逻辑 y。
 * @returns 色块下标，未命中返回 -1。
 */
export function paletteSwatchAt(count: number, px: number, py: number): number {
  for (let i = 0; i < count; i += 1) {
    const r = paletteSwatchRect(i, count)
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return i
  }
  return -1
}

/** 一帧的完整绘制视图（index 层组装）。 */
export interface SceneView {
  /** 参考图（-1 空、否则颜色下标）。 */
  reference: number[]
  /** 玩家画布（同编码）。 */
  canvas: number[]
  /** 网格边长。 */
  grid: number
  /** 颜色下标到十六进制色值。 */
  colors: string[]
  /** 调色板色块顺序（颜色下标）。 */
  palette: number[]
  /** 选中的调色板槽位，-1 未选。 */
  selected: number
  /** 涂改步数。 */
  steps: number
  /** 错格数。 */
  wrong: number
  /** 完成度百分比。 */
  pct: number
  /** 0 起的关卡下标。 */
  level: number
  /** 总关卡数。 */
  levelCount: number
  /** 剩余提示次数。 */
  hintsLeft: number
  /** 过关闪亮脉冲 0-1。 */
  flash: number
}

function drawPanel(ctx: CanvasRenderingContext2D, area: Rect): void {
  ctx.fillStyle = THEME.panel
  roundRectPath(ctx, area.x, area.y, area.w, area.h, 12)
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
}

function drawGridLines(ctx: CanvasRenderingContext2D, layout: Layout, grid: number): void {
  ctx.strokeStyle = 'rgba(226,226,238,0.08)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i <= grid; i += 1) {
    ctx.moveTo(layout.ox + i * layout.cell, layout.oy)
    ctx.lineTo(layout.ox + i * layout.cell, layout.oy + grid * layout.cell)
    ctx.moveTo(layout.ox, layout.oy + i * layout.cell)
    ctx.lineTo(layout.ox + grid * layout.cell, layout.oy + i * layout.cell)
  }
  ctx.stroke()
  ctx.strokeStyle = 'rgba(226,226,238,0.2)'
  ctx.strokeRect(layout.ox, layout.oy, grid * layout.cell, grid * layout.cell)
}

/**
 * 画参考图：空格深底、彩色格满色、格线覆盖。
 * @param ctx - 画布上下文。
 * @param layout - 盘面布局。
 * @param view - 本帧视图。
 */
function drawReference(ctx: CanvasRenderingContext2D, layout: Layout, view: SceneView): void {
  const s = layout.cell
  for (let y = 0; y < view.grid; y += 1) {
    for (let x = 0; x < view.grid; x += 1) {
      const px = layout.ox + x * s
      const py = layout.oy + y * s
      const colorIdx = view.reference[y * view.grid + x]!
      ctx.fillStyle = 'rgba(226,226,238,0.05)'
      ctx.fillRect(px + 1, py + 1, s - 2, s - 2)
      if (colorIdx >= 0) {
        ctx.fillStyle = view.colors[colorIdx]!
        ctx.fillRect(px + 2, py + 2, s - 4, s - 4)
      }
    }
  }
  drawGridLines(ctx, layout, view.grid)
}

/**
 * 画玩家画布：涂对且非空的格子叠白微亮，涂错的格子红框警示。
 * @param ctx - 画布上下文。
 * @param layout - 盘面布局。
 * @param view - 本帧视图。
 */
function drawPlayerCanvas(ctx: CanvasRenderingContext2D, layout: Layout, view: SceneView): void {
  const s = layout.cell
  for (let y = 0; y < view.grid; y += 1) {
    for (let x = 0; x < view.grid; x += 1) {
      const px = layout.ox + x * s
      const py = layout.oy + y * s
      const at = y * view.grid + x
      const ref = view.reference[at]!
      const cur = view.canvas[at]!
      const ok = ref === cur
      ctx.fillStyle = 'rgba(226,226,238,0.05)'
      ctx.fillRect(px + 1, py + 1, s - 2, s - 2)
      if (cur >= 0) {
        ctx.fillStyle = view.colors[cur]!
        ctx.fillRect(px + 2, py + 2, s - 4, s - 4)
        if (ok) {
          // 涂对微亮：白色低透明叠加，保持原色可辨。
          ctx.fillStyle = 'rgba(255,255,255,0.14)'
          ctx.fillRect(px + 2, py + 2, s - 4, s - 4)
        }
      }
      if (!ok) {
        ctx.strokeStyle = THEME.bad
        ctx.lineWidth = 2
        ctx.strokeRect(px + 2, py + 2, s - 4, s - 4)
        ctx.lineWidth = 1
      }
    }
  }
  drawGridLines(ctx, layout, view.grid)
}

/**
 * 整帧绘制：背景 + HUD + 双面板（参考图/画布）+ 调色板 + 过关闪亮。
 * 说明按钮与帮助面板在 drawHelp（index 层渲染函数最末调用，最上层）。
 * @param ctx - 画布上下文。
 * @param view - 本帧视图。
 */
export function renderScene(ctx: CanvasRenderingContext2D, view: SceneView): void {
  drawBackground(ctx, LOGICAL_W, LOGICAL_H)

  // HUD 行（基线 y26）：左侧关卡与提示，右侧步数/错格/完成度（右锚定）。
  hudPair(ctx, 16, 26, '关卡', (view.level + 1) + '/' + view.levelCount)
  hudPair(ctx, 150, 26, '提示', 'x' + view.hintsLeft)
  hudPair(ctx, 500, 26, '步数', String(view.steps), 'right')
  hudPair(ctx, 596, 26, '错格', String(view.wrong), 'right', view.wrong > 0 ? THEME.bad : THEME.text)
  hudPair(ctx, 704, 26, '完成度', view.pct + '%', 'right', view.pct === 100 ? THEME.good : THEME.text)

  // 面板标签（基线 y60，居中于各自面板上方）。
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('参考图', LEFT_PANEL.x + LEFT_PANEL.w / 2, 60)
  ctx.fillStyle = THEME.text
  ctx.fillText('你的画布', RIGHT_PANEL.x + RIGHT_PANEL.w / 2, 60)

  drawPanel(ctx, LEFT_PANEL)
  drawPanel(ctx, RIGHT_PANEL)
  const leftLayout = layoutFor(LEFT_PANEL, view.grid)
  const rightLayout = layoutFor(RIGHT_PANEL, view.grid)
  drawReference(ctx, leftLayout, view)
  drawPlayerCanvas(ctx, rightLayout, view)

  // 调色板托盘（底部圆角面板，色块整行居中）。
  ctx.fillStyle = THEME.panel
  roundRectPath(ctx, TRAY.x, TRAY.y, TRAY.w, TRAY.h, 12)
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  view.palette.forEach((colorIdx, i) => {
    const r = paletteSwatchRect(i, view.palette.length)
    const active = i === view.selected
    if (active) glow(ctx, view.colors[colorIdx]!, 14)
    roundRectPath(ctx, r.x, r.y, r.w, r.h, 8)
    ctx.fillStyle = view.colors[colorIdx]!
    ctx.fill()
    noGlow(ctx)
    ctx.strokeStyle = active ? THEME.text : THEME.panelEdge
    ctx.lineWidth = active ? 2.5 : 1
    ctx.stroke()
    ctx.lineWidth = 1
    if (active) {
      ctx.font = '600 10px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillStyle = THEME.text
      ctx.fillText('当前颜色', r.x + r.w / 2, r.y + r.h + 13)
    }
  })

  // 过关闪亮：两图同亮脉冲。
  if (view.flash > 0) {
    ctx.fillStyle = 'rgba(158,206,106,' + (view.flash * 0.22).toFixed(3) + ')'
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H)
  }
}

/** 说明按钮矩形（右下角，60x24）。 */
export const HELP_BTN: Rect = { x: LOGICAL_W - 76, y: LOGICAL_H - 28, w: 60, h: 24 }
/** 帮助面板矩形。 */
const HELP_PANEL: Rect = { x: 90, y: 110, w: 540, h: 320 }
/** 帮助面板文案（标题 + 7 行规则）。 */
const HELP_LINES = [
  '玩法说明',
  '· 左侧是参考图，右侧是你的画布：把颜色涂到正确的格子上',
  '· 底部调色板选色（顺序已打乱）；左键涂色，右键清除一格',
  '· 实时比对：涂对的格子微微发亮，涂错的格子有红框警示',
  '· 空格也是颜色：多涂的格子要右键清掉，全格一致才过关',
  '· 涂改会计步（重涂同色不算）：步数越少，过关得分越高',
  '· H 提示：自动修正一个错格，每关限 2 次；R 重开 · P 暂停',
  '· 完成度 = 涂对格数比例；过关后点击画面进入下一关',
]

/**
 * 说明按钮 + 帮助面板：必须由 index 层在渲染函数最末调用，保证画在
 * 一切场景与 overlay 之上（暂停/过关中也可开合）。
 * @param ctx - 画布上下文。
 * @param helpOpen - 帮助面板是否展开。
 */
export function drawHelp(ctx: CanvasRenderingContext2D, helpOpen: boolean): void {
  ctx.fillStyle = THEME.panel
  roundRectPath(ctx, HELP_BTN.x, HELP_BTN.y, HELP_BTN.w, HELP_BTN.h, 8)
  ctx.fill()
  ctx.strokeStyle = helpOpen ? accent(2) : THEME.panelEdge
  ctx.lineWidth = helpOpen ? 2 : 1
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.textAlign = 'center'
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.fillStyle = helpOpen ? accent(2) : THEME.textMuted
  ctx.fillText('说明', HELP_BTN.x + HELP_BTN.w / 2, HELP_BTN.y + 16)
  if (!helpOpen) return
  ctx.fillStyle = 'rgba(13,13,20,0.92)'
  roundRectPath(ctx, HELP_PANEL.x, HELP_PANEL.y, HELP_PANEL.w, HELP_PANEL.h, 10)
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.stroke()
  ctx.textAlign = 'left'
  HELP_LINES.forEach((line, i) => {
    ctx.font = i === 0 ? 'bold 16px system-ui, sans-serif' : '600 15px system-ui, sans-serif'
    ctx.fillStyle = i === 0 ? accent(2) : THEME.text
    ctx.fillText(line, HELP_PANEL.x + 20, HELP_PANEL.y + 34 + i * 32)
  })
}
