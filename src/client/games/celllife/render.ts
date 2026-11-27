/**
 * 生命播种 CellLife 渲染层：培养皿风 8x8 盘面（细胞圆点辉光、起始区
 * 虚线框）、右侧目标图案与下一步预览小图对照、进化动画（死亡红点淡出、
 * 新生绿点闪现）、步数 HUD 与说明按钮 + 帮助面板（渲染末尾最上层）。
 * 纯绘制，无状态；布局常量集中声明并核算互不遮挡（HUD 行 y26：左侧
 * 关卡 x16、中题 x246 居中、右剩步 x704 右锚，三段净距 ≥130px；盘面
 * 38-454 x 50-466；目标面板 480-704 x 48-268；预览面板 480-704 x
 * 284-504；底部提示带 y530 与说明按钮 644-704 x 528-552，均在 720x560
 * 逻辑画布内）。无反引号模板字符串。
 */
import type { Board, Cell, LevelData } from './logic.ts'
import { GRID } from './logic.ts'
import { accent, drawBackground, glow, hudPair, noGlow, roundRectPath, THEME } from '../theme.ts'

/** 逻辑画布尺寸。 */
export const LOGICAL_W = 720
export const LOGICAL_H = 560

/** 网格盘面布局：左上角与单元边长（含居中边距）。 */
export interface Layout {
  ox: number
  oy: number
  cell: number
}

/** 主盘面区域与右栏面板（逻辑坐标矩形，核算互不遮挡）。 */
interface Rect { x: number; y: number; w: number; h: number }

const BOARD_AREA: Rect = { x: 16, y: 48, w: 460, h: 420 }
const TARGET_PANEL: Rect = { x: 480, y: 48, w: 224, h: 220 }
const PREVIEW_PANEL: Rect = { x: 480, y: 284, w: 224, h: 220 }
/** 说明按钮矩形（右下角，60x24）。 */
export const HELP_BTN = { x: LOGICAL_W - 76, y: LOGICAL_H - 32, w: 60, h: 24 }

/** 帮助面板矩形。 */
const HELP_PANEL = { x: LOGICAL_W / 2 - 280, y: LOGICAL_H - 216, w: 560, h: 196 }
/** 帮助面板文案（15-16px 大字，完整规则 + 易误解点）。 */
const HELP_LINES = [
  '玩法速览',
  '· 摆放阶段：点击中心虚线起始区内的格子放置/移除细胞',
  '· 空格进化一步（B3/S23）：3 邻居出生，2/3 邻居存活，其余死亡',
  '· 恰好 K 步后的图案与右栏「目标图案」完全一致才过关——多一步少一步都不行',
  '· T 键开关「下一步预览」：不消耗步数地看当前盘面进化一步的样子',
  '· 一旦按下空格便进入观察阶段，不能再补摆；步数用尽未达标按 R 重摆',
  '· 细胞只能摆在起始区内；盘外视为死亡，图案不会扩散出 8x8 边界',
  '· R 重摆本关 · P 暂停 · 过关自动进入下一关，进度自动保存',
]

/**
 * 主盘面布局：8x8 网格在盘面区域内自适应（单元取整、整体居中含边距）。
 * @returns 盘面布局。
 */
export function boardLayout(): Layout {
  const cell = Math.floor(Math.min(BOARD_AREA.w / GRID, BOARD_AREA.h / GRID))
  return {
    ox: BOARD_AREA.x + (BOARD_AREA.w - cell * GRID) / 2,
    oy: BOARD_AREA.y + (BOARD_AREA.h - cell * GRID) / 2,
    cell,
  }
}

/**
 * 命中测试：逻辑坐标转网格单元，越界返回 null。
 * @param layout - 盘面布局。
 * @param px - 逻辑 x。
 * @param py - 逻辑 y。
 * @returns 命中的网格单元，或 null。
 */
export function cellFromPoint(layout: Layout, px: number, py: number): Cell | null {
  const gx = Math.floor((px - layout.ox) / layout.cell)
  const gy = Math.floor((py - layout.oy) / layout.cell)
  if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) return null
  return { x: gx, y: gy }
}

/** 一帧的完整绘制视图（index 层组装）。 */
export interface SceneView {
  /** 当前关卡数据（K、起始区、目标）。 */
  data: LevelData
  /** 当前盘面。 */
  board: Board
  /** 进化动画的前一帧盘面（null 表示无动画）。 */
  prevBoard: Board | null
  /** 进化动画进度：1 起衰减到 0，0 表示无动画。 */
  anim: number
  /** 是否处于摆放阶段（未进化，可点击摆格）。 */
  placing: boolean
  /** T 预览是否开启。 */
  previewOn: boolean
  /** 预览盘面（index 层由 previewNext 计算，关闭时为 null）。 */
  previewBoard: Board | null
  /** HUD 关卡值（如 '1/5'）。 */
  hudLevel: string
  /** 已进化步数。 */
  steps: number
}

function cellCenter(layout: Layout, x: number, y: number): { x: number; y: number } {
  return { x: layout.ox + (x + 0.5) * layout.cell, y: layout.oy + (y + 0.5) * layout.cell }
}

/**
 * 培养皿底：圆角面板 + 方格纸网格线 + 边框。
 * @param ctx - 画布上下文。
 * @param layout - 盘面布局。
 */
function drawDish(ctx: CanvasRenderingContext2D, layout: Layout): void {
  ctx.fillStyle = THEME.panel
  roundRectPath(ctx, BOARD_AREA.x, BOARD_AREA.y, BOARD_AREA.w, BOARD_AREA.h, 18)
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.lineWidth = 1
  const s = layout.cell
  ctx.strokeStyle = 'rgba(226,226,238,0.07)'
  ctx.beginPath()
  for (let i = 0; i <= GRID; i += 1) {
    ctx.moveTo(layout.ox + i * s, layout.oy)
    ctx.lineTo(layout.ox + i * s, layout.oy + GRID * s)
    ctx.moveTo(layout.ox, layout.oy + i * s)
    ctx.lineTo(layout.ox + GRID * s, layout.oy + i * s)
  }
  ctx.stroke()
}

/**
 * 起始区虚线框（金色）+ 摆放阶段区内淡槽位。
 * @param ctx - 画布上下文。
 * @param layout - 盘面布局。
 * @param data - 关卡数据。
 * @param placing - 是否摆放阶段（仅此阶段画槽位提示）。
 */
function drawZone(ctx: CanvasRenderingContext2D, layout: Layout, data: LevelData, placing: boolean): void {
  const o = data.zoneOrigin
  const s = layout.cell
  const x = layout.ox + o.x * s
  const y = layout.oy + o.y * s
  const w = data.zone * s
  ctx.save()
  ctx.strokeStyle = THEME.gold
  ctx.lineWidth = 1.5
  ctx.setLineDash([7, 5])
  ctx.strokeRect(x + 1, y + 1, w - 2, w - 2)
  ctx.restore()
  if (!placing) return
  ctx.fillStyle = 'rgba(224,175,104,0.12)'
  for (let dy = 0; dy < data.zone; dy += 1) {
    for (let dx = 0; dx < data.zone; dx += 1) {
      const c = cellCenter(layout, o.x + dx, o.y + dy)
      ctx.beginPath()
      ctx.arc(c.x, c.y, s * 0.18, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

/**
 * 画一个细胞圆点（带辉光）。
 * @param ctx - 画布上下文。
 * @param layout - 盘面布局。
 * @param x - 列。
 * @param y - 行。
 * @param color - 主色。
 * @param radius - 半径缩放（相对单元）。
 * @param alpha - 透明度。
 * @param blur - 辉光强度。
 */
function drawCellDot(
  ctx: CanvasRenderingContext2D, layout: Layout, x: number, y: number,
  color: string, radius: number, alpha: number, blur: number,
): void {
  const c = cellCenter(layout, x, y)
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  glow(ctx, color, blur)
  ctx.beginPath()
  ctx.arc(c.x, c.y, layout.cell * radius, 0, Math.PI * 2)
  ctx.fill()
  noGlow(ctx)
  ctx.globalAlpha = 1
}

/**
 * 主盘面细胞绘制：按「当前存活 / 动画新生 / 动画死亡 / 空格」显式分支
 * ——动画中三分并存：新生绿点闪现放大、死亡红点淡出、存活绿点常亮；
 * 无动画时只走存活/空格两分支。空格在摆放阶段且位于起始区内时以淡金
 * 槽位提示（槽位由 drawZone 统一绘制，此处不重复画）。
 * @param ctx - 画布上下文。
 * @param layout - 盘面布局。
 * @param view - 本帧视图。
 */
function drawCells(ctx: CanvasRenderingContext2D, layout: Layout, view: SceneView): void {
  const prev = view.prevBoard
  const anim = view.anim
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      const i = y * GRID + x
      const alive = view.board[i] === true
      const was = prev !== null && prev[i] === true
      if (alive) {
        if (prev !== null && !was) {
          // 新生：闪现（半径随动画从 0.42 弹到 0.3，辉光强）。
          const pop = 0.42 - 0.12 * anim
          drawCellDot(ctx, layout, x, y, THEME.good, pop, 1, 14)
        } else {
          // 存活：常亮绿点。
          drawCellDot(ctx, layout, x, y, THEME.good, 0.3, 1, 10)
        }
      } else if (was) {
        // 死亡：红点随动画淡出缩小。
        drawCellDot(ctx, layout, x, y, THEME.bad, 0.12 + 0.18 * anim, anim, 8)
      }
      // 空格且非死亡残留：不画（网格线即底）。
    }
  }
}

/**
 * 右栏小图：8x8 迷你网格中画一组细胞（小方块）。
 * @param ctx - 画布上下文。
 * @param panel - 面板矩形。
 * @param title - 面板标题。
 * @param cells - 要画的细胞集合（网格坐标）。
 * @param color - 细胞颜色。
 * @param emptyHint - 集合为空时的提示文案。
 */
function drawMiniDiagram(
  ctx: CanvasRenderingContext2D, panel: Rect, title: string, cells: Cell[], color: string, emptyHint: string,
): void {
  ctx.fillStyle = THEME.panel
  roundRectPath(ctx, panel.x, panel.y, panel.w, panel.h, 12)
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.font = '600 14px system-ui, sans-serif'
  ctx.fillStyle = THEME.text
  ctx.fillText(title, panel.x + panel.w / 2, panel.y + 26)
  const mini = 21
  const span = mini * GRID
  const gx = panel.x + (panel.w - span) / 2
  const gy = panel.y + 40
  ctx.strokeStyle = 'rgba(226,226,238,0.09)'
  ctx.strokeRect(gx, gy, span, span)
  ctx.strokeStyle = 'rgba(226,226,238,0.05)'
  ctx.beginPath()
  for (let i = 1; i < GRID; i += 1) {
    ctx.moveTo(gx + i * mini, gy)
    ctx.lineTo(gx + i * mini, gy + span)
    ctx.moveTo(gx, gy + i * mini)
    ctx.lineTo(gx + span, gy + i * mini)
  }
  ctx.stroke()
  if (cells.length === 0) {
    ctx.font = '600 12px system-ui, sans-serif'
    ctx.fillStyle = THEME.textMuted
    ctx.fillText(emptyHint, panel.x + panel.w / 2, gy + span + 22)
    return
  }
  for (const c of cells) {
    ctx.fillStyle = color
    glow(ctx, color, 5)
    ctx.fillRect(gx + c.x * mini + 2, gy + c.y * mini + 2, mini - 4, mini - 4)
    noGlow(ctx)
  }
}

/**
 * 整帧绘制：背景 + HUD + 培养皿盘面 + 右栏目标/预览小图 + 底部提示 +
 * 说明按钮与帮助面板（末尾最上层）。overlay 由 index 层随后叠加。
 * @param ctx - 画布上下文。
 * @param view - 本帧视图。
 * @param helpOpen - 说明面板是否打开。
 */
export function renderScene(ctx: CanvasRenderingContext2D, view: SceneView, helpOpen = false): void {
  drawBackground(ctx, LOGICAL_W, LOGICAL_H)

  // HUD 行（基线 y=26）：左关卡、中阶段、右剩余步（右锚定宽）。
  hudPair(ctx, 16, 26, '关卡', view.hudLevel)
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = view.placing ? accent(2) : THEME.textMuted
  ctx.fillText(view.placing ? '阶段：摆放细胞' : '阶段：观察进化', 246, 26)
  const left = view.data.steps - view.steps
  hudPair(ctx, 704, 26, '剩余', left + ' 步', 'right', left > 0 ? THEME.text : THEME.bad)

  const layout = boardLayout()
  drawDish(ctx, layout)
  drawZone(ctx, layout, view.data, view.placing)
  drawCells(ctx, layout, view)

  // 右栏：目标小图（始终对照）。
  drawMiniDiagram(ctx, TARGET_PANEL, '目标图案（' + view.data.steps + ' 步后）', view.data.target, THEME.gold, '（空）')

  // 右栏：预览小图（T 开关；观察阶段也可见，但只是推演不生效）。
  if (view.previewOn && view.previewBoard !== null) {
    const cells: Cell[] = []
    for (let y = 0; y < GRID; y += 1) {
      for (let x = 0; x < GRID; x += 1) {
        if (view.previewBoard[y * GRID + x] === true) cells.push({ x, y })
      }
    }
    drawMiniDiagram(ctx, PREVIEW_PANEL, '下一步预览 (T)', cells, accent(0), '（全灭）')
  } else {
    ctx.fillStyle = THEME.panel
    roundRectPath(ctx, PREVIEW_PANEL.x, PREVIEW_PANEL.y, PREVIEW_PANEL.w, PREVIEW_PANEL.h, 12)
    ctx.fill()
    ctx.strokeStyle = THEME.panelEdge
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.font = '600 13px system-ui, sans-serif'
    ctx.fillStyle = THEME.textMuted
    ctx.fillText('按 T 查看下一步预览', PREVIEW_PANEL.x + PREVIEW_PANEL.w / 2, PREVIEW_PANEL.y + PREVIEW_PANEL.h / 2)
  }

  // 底部提示带（盘面下方 y=530，单条文案，与说明按钮净距 >200px）。
  ctx.textAlign = 'center'
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('空格：进化一步 · T：预览 · R：重摆 · P：暂停', 245, 536)

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
      ctx.fillText(line, HELP_PANEL.x + 14, HELP_PANEL.y + 26 + i * 23)
    })
  }
}
