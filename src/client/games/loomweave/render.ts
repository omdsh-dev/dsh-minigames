/**
 * 织机穿梭 LoomWeave 渲染层：纺织工坊风——织机面板（经线竖线、已织
 * 行逐行堆叠的 over/under 色格、错色格红框对照）、下方「下一行」预览
 * 条（over 亮实 / under 暗沉小格）、右栏图案卡 / 色线篮 / 起始偏移钮、
 * HUD 与说明按钮 + 帮助面板（渲染末尾最上层）。
 * 布局核算（逻辑画布 720x560，两两不相交、不越界；同水平带 fillText
 * 净距 ≥20px）：HUD 带 y26——左「关卡」x16（约至 x98）、中题「织机穿梭」
 * x360 居中（约 330-390）、右「误差」x704 右锚（约 640-704），净距
 * ≥230px；织机面板 16-460 x 48-432；预览条 16-460 x 440-484（内文三段：
 * 「下一行」x28（至约 x80）、预览格 x100 起（≤x254）、「第 r/M 行」x448
 * 右锚（约 378-448），净距 ≥94px）；图案卡 480-704 x 48-298；色线篮
 * 480-704 x 306-390；偏移钮 480-704 x 398-484（钮内数字 x 相距 48px）；
 * 底部提示带 y510 居中单条；说明按钮 644-704 x 528-552；帮助面板
 * 80-640 x 344-540（最上层覆盖层，行距 22px）。格子绘制按显式状态分支：
 * 织机格三态——未织（经线竖线）/ 已织 over（纬色实块+亮顶边）/ 已织
 * under（经色暗底+竖线残留）；预览格两态——preview over / preview
 * under；互不串道。无反引号模板字符串。
 */
import { WEAVE_PERIOD, isOver, type LevelData, type Phase, type RowChoice } from './logic.ts'
import { accent, drawBackground, drawOverlay, glow, hudPair, noGlow, roundRectPath, THEME, type ParticleSystem } from '../theme.ts'

/** 逻辑画布尺寸。 */
export const LOGICAL_W = 720
export const LOGICAL_H = 560

/** 说明按钮矩形（右下角，60x24）。 */
export const HELP_BTN = { x: LOGICAL_W - 76, y: LOGICAL_H - 32, w: 60, h: 24 }

interface Rect { x: number; y: number; w: number; h: number }

/** 织机面板（主织造区）。 */
const LOOM_PANEL: Rect = { x: 16, y: 48, w: 444, h: 384 }
/** 下一行预览条。 */
const PREVIEW_PANEL: Rect = { x: 16, y: 440, w: 444, h: 44 }
/** 图案卡面板。 */
const TARGET_PANEL: Rect = { x: 480, y: 48, w: 224, h: 250 }
/** 色线篮面板。 */
const BASKET_PANEL: Rect = { x: 480, y: 306, w: 224, h: 84 }
/** 起始偏移面板。 */
const OFFSET_PANEL: Rect = { x: 480, y: 398, w: 224, h: 86 }
/** 帮助面板矩形。 */
const HELP_PANEL: Rect = { x: LOGICAL_W / 2 - 280, y: LOGICAL_H - 216, w: 560, h: 196 }

/** 帮助面板文案（15-16px 大字，完整规则 + 易误解点）。 */
const HELP_LINES = [
  '玩法速览',
  '· 每列经线颜色固定；图案卡是要织出的目标纹样',
  '· 每行先点色线篮选纬线色，再点 0-3 起始偏移钮',
  '· 偏移把「压压沉沉」基序列整体循环移位',
  '· 压过(over)显纬线色，沉入(under)透出该列经线色',
  '· 预览条即下一行；回车织入，Z 拆一行 · R 重开 · P 暂停',
  '· 织满 M 行后对照图案卡：错色格数 ≤ 容差过关（红框标错）',
  '· 易误解：under 格颜色来自经线；列数非 4 倍数时纹路错位',
]

/** 织机格自适应布局（居中含边距）。 */
interface ClothLayout {
  ox: number
  oy: number
  cell: number
}

/**
 * 织机网格布局：在织机面板内按 cols×rows 自适应取整并居中。
 * @param data - 关卡数据。
 * @returns 网格布局。
 */
export function clothLayout(data: LevelData): ClothLayout {
  const innerX = LOOM_PANEL.x + 12
  const innerY = LOOM_PANEL.y + 12
  const innerW = LOOM_PANEL.w - 24
  const innerH = LOOM_PANEL.h - 24
  const cell = Math.floor(Math.min(innerW / data.cols, innerH / data.rows))
  return {
    ox: innerX + (innerW - cell * data.cols) / 2,
    oy: innerY + (innerH - cell * data.rows) / 2,
    cell,
  }
}

/**
 * 命中测试：色线篮里的色线索引（点中色块返回 0..colors-1）。
 * @param data - 关卡数据（取色数）。
 * @param x - 逻辑 x。
 * @param y - 逻辑 y。
 * @returns 色索引，或 null。
 */
export function threadFromPoint(data: LevelData, x: number, y: number): number | null {
  const top = BASKET_PANEL.y + 34
  if (y < top || y > top + 40) return null
  for (let c = 0; c < data.colors; c += 1) {
    const sx = BASKET_PANEL.x + 12 + c * 48
    if (x >= sx && x <= sx + 40) return c
  }
  return null
}

/**
 * 命中测试：起始偏移钮（点中返回 0..3）。
 * @param x - 逻辑 x。
 * @param y - 逻辑 y。
 * @returns 偏移值，或 null。
 */
export function offsetFromPoint(x: number, y: number): number | null {
  const top = OFFSET_PANEL.y + 32
  if (y < top || y > top + 38) return null
  for (let o = 0; o < WEAVE_PERIOD; o += 1) {
    const bx = OFFSET_PANEL.x + 12 + o * 48
    if (x >= bx && x <= bx + 40) return o
  }
  return null
}

/** 一帧的完整绘制视图（index 层组装）。 */
export interface SceneView {
  /** 关卡数据。 */
  data: LevelData
  /** 已织入各行的选择（自上而下）。 */
  woven: RowChoice[]
  /** 已织入各行的视觉色（clothColors 计算）。 */
  cloth: number[][]
  /** 当前选中的纬线色。 */
  selectedColor: number
  /** 当前起始偏移（0..3）。 */
  offset: number
  /** 阶段。 */
  phase: Phase
  /** 是否暂停。 */
  paused: boolean
  /** HUD 关卡值（如 '1/5'）。 */
  hudLevel: string
  /** 当前误差格数（已织部分）。 */
  error: number
}

/** 面板底：圆角矩形 + 边框。 */
function drawPanel(ctx: CanvasRenderingContext2D, panel: Rect): void {
  ctx.fillStyle = THEME.panel
  roundRectPath(ctx, panel.x, panel.y, panel.w, panel.h, 12)
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.lineWidth = 1
}

/** 面板标题（居中 14px）。 */
function drawPanelTitle(ctx: CanvasRenderingContext2D, panel: Rect, title: string): void {
  ctx.textAlign = 'center'
  ctx.font = '600 14px system-ui, sans-serif'
  ctx.fillStyle = THEME.text
  ctx.fillText(title, panel.x + panel.w / 2, panel.y + 24)
}

/**
 * 织机主体。格子按显式状态三分支：
 *   未织格 → 画该列经线竖线（经色细条 + 暗底）；
 *   已织 over → 纬色实块 + 亮顶边（纬线压在经线上）；
 *   已织 under → 经色暗块 + 竖线残留（纬线沉入经线下）。
 * 已织格与目标不一致时叠红框对照。
 * @param ctx - 画布上下文。
 * @param view - 本帧视图。
 * @param layout - 网格布局。
 */
function drawCloth(ctx: CanvasRenderingContext2D, view: SceneView, layout: ClothLayout): void {
  const { data, cloth, woven } = view
  const s = layout.cell
  for (let r = 0; r < data.rows; r += 1) {
    for (let c = 0; c < data.cols; c += 1) {
      const x = layout.ox + c * s
      const y = layout.oy + r * s
      const wovenRow = r < woven.length
      if (!wovenRow) {
        // 未织：经线竖线。
        ctx.fillStyle = 'rgba(16,16,26,0.6)'
        ctx.fillRect(x, y, s, s)
        const wx = x + s * 0.28
        ctx.fillStyle = accent(data.warp[c]!)
        ctx.globalAlpha = 0.9
        ctx.fillRect(wx, y + 2, s * 0.16, s - 4)
        ctx.globalAlpha = 1
        continue
      }
      const over = isOver(c, woven[r]!.offset)
      if (over) {
        // 已织 over：纬色实块 + 亮顶边。
        ctx.fillStyle = accent(cloth[r]![c]!)
        ctx.fillRect(x + 1, y + 1, s - 2, s - 2)
        ctx.fillStyle = 'rgba(255,255,255,0.28)'
        ctx.fillRect(x + 1, y + 1, s - 2, 3)
      } else {
        // 已织 under：经色暗块 + 竖线残留。
        ctx.fillStyle = 'rgba(16,16,26,0.5)'
        ctx.fillRect(x + 1, y + 1, s - 2, s - 2)
        ctx.fillStyle = accent(cloth[r]![c]!)
        ctx.globalAlpha = 0.75
        ctx.fillRect(x + s * 0.3, y + 3, s * 0.14, s - 6)
        ctx.globalAlpha = 1
      }
      if (cloth[r]![c] !== data.target[r]![c]) {
        // 错色格红框对照。
        ctx.strokeStyle = THEME.bad
        ctx.lineWidth = 2
        ctx.strokeRect(x + 2.5, y + 2.5, s - 5, s - 5)
        ctx.lineWidth = 1
      }
    }
  }
  // 网格线。
  ctx.strokeStyle = 'rgba(226,226,238,0.08)'
  ctx.beginPath()
  for (let c = 0; c <= data.cols; c += 1) {
    ctx.moveTo(layout.ox + c * s, layout.oy)
    ctx.lineTo(layout.ox + c * s, layout.oy + data.rows * s)
  }
  for (let r = 0; r <= data.rows; r += 1) {
    ctx.moveTo(layout.ox, layout.oy + r * s)
    ctx.lineTo(layout.ox + data.cols * s, layout.oy + r * s)
  }
  ctx.stroke()
  // 织口线：下一行待织位置的高亮框（仅 play 且未织满）。
  if (view.phase === 'play' && woven.length < data.rows) {
    const y = layout.oy + woven.length * s
    ctx.strokeStyle = THEME.gold
    ctx.lineWidth = 1.5
    ctx.setLineDash([7, 5])
    ctx.strokeRect(layout.ox + 1, y + 1, data.cols * s - 2, s - 2)
    ctx.setLineDash([])
    ctx.lineWidth = 1
  }
}

/**
 * 下一行预览条：显式两分支——preview over（纬色亮块+白顶边）/ preview
 * under（经色暗块+竖线）。
 * @param ctx - 画布上下文。
 * @param view - 本帧视图。
 */
function drawPreview(ctx: CanvasRenderingContext2D, view: SceneView): void {
  drawPanel(ctx, PREVIEW_PANEL)
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('下一行', PREVIEW_PANEL.x + 12, PREVIEW_PANEL.y + 27)
  const { data } = view
  const s = 22
  const bx = PREVIEW_PANEL.x + 84
  const by = PREVIEW_PANEL.y + 11
  for (let c = 0; c < data.cols; c += 1) {
    const x = bx + c * s
    if (isOver(c, view.offset)) {
      // preview over：纬色亮块 + 白顶边。
      ctx.fillStyle = accent(view.selectedColor)
      glow(ctx, accent(view.selectedColor), 6)
      ctx.fillRect(x + 1, by + 1, s - 2, s - 2)
      noGlow(ctx)
      ctx.fillStyle = 'rgba(255,255,255,0.4)'
      ctx.fillRect(x + 1, by + 1, s - 2, 3)
    } else {
      // preview under：经色暗块 + 竖线。
      ctx.fillStyle = 'rgba(16,16,26,0.55)'
      ctx.fillRect(x + 1, by + 1, s - 2, s - 2)
      ctx.fillStyle = accent(data.warp[c]!)
      ctx.fillRect(x + s * 0.36, by + 3, s * 0.14, s - 6)
    }
  }
  ctx.textAlign = 'right'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('第 ' + Math.min(view.woven.length + 1, data.rows) + '/' + data.rows + ' 行', PREVIEW_PANEL.x + PREVIEW_PANEL.w - 12, PREVIEW_PANEL.y + 27)
}

/**
 * 图案卡：目标纹样迷你网格（自适应居中）。
 * @param ctx - 画布上下文。
 * @param view - 本帧视图。
 */
function drawTarget(ctx: CanvasRenderingContext2D, view: SceneView): void {
  drawPanel(ctx, TARGET_PANEL)
  drawPanelTitle(ctx, TARGET_PANEL, '图案卡')
  const { data } = view
  const innerX = TARGET_PANEL.x + 12
  const innerY = TARGET_PANEL.y + 36
  const innerW = TARGET_PANEL.w - 24
  const innerH = TARGET_PANEL.h - 48
  const cell = Math.floor(Math.min(innerW / data.cols, innerH / data.rows))
  const ox = innerX + (innerW - cell * data.cols) / 2
  const oy = innerY + (innerH - cell * data.rows) / 2
  for (let r = 0; r < data.rows; r += 1) {
    for (let c = 0; c < data.cols; c += 1) {
      ctx.fillStyle = accent(data.target[r]![c]!)
      ctx.fillRect(ox + c * cell + 1, oy + r * cell + 1, cell - 2, cell - 2)
    }
  }
  ctx.strokeStyle = THEME.panelEdge
  ctx.strokeRect(ox, oy, cell * data.cols, cell * data.rows)
}

/**
 * 色线篮：色线色块（选中发光 + 边框）。色线数 ≤4，48px 间距不重叠。
 * @param ctx - 画布上下文。
 * @param view - 本帧视图。
 */
function drawBasket(ctx: CanvasRenderingContext2D, view: SceneView): void {
  drawPanel(ctx, BASKET_PANEL)
  drawPanelTitle(ctx, BASKET_PANEL, '色线篮')
  for (let c = 0; c < view.data.colors; c += 1) {
    const x = BASKET_PANEL.x + 12 + c * 48
    const y = BASKET_PANEL.y + 34
    const color = accent(c)
    if (c === view.selectedColor) {
      glow(ctx, color, 12)
      ctx.fillStyle = color
      ctx.fillRect(x, y, 40, 40)
      noGlow(ctx)
      ctx.strokeStyle = THEME.text
      ctx.lineWidth = 2
      ctx.strokeRect(x, y, 40, 40)
      ctx.lineWidth = 1
    } else {
      ctx.fillStyle = color
      ctx.globalAlpha = 0.55
      ctx.fillRect(x, y, 40, 40)
      ctx.globalAlpha = 1
      ctx.strokeStyle = THEME.panelEdge
      ctx.strokeRect(x, y, 40, 40)
    }
  }
}

/**
 * 起始偏移钮：4 个 40x38 钮（0-3），选中高亮。钮内数字 fillText 中心
 * 相距 48px（≥20px 净距）。
 * @param ctx - 画布上下文。
 * @param view - 本帧视图。
 */
function drawOffset(ctx: CanvasRenderingContext2D, view: SceneView): void {
  drawPanel(ctx, OFFSET_PANEL)
  drawPanelTitle(ctx, OFFSET_PANEL, '起始偏移')
  ctx.font = '600 15px system-ui, sans-serif'
  for (let o = 0; o < WEAVE_PERIOD; o += 1) {
    const x = OFFSET_PANEL.x + 12 + o * 48
    const y = OFFSET_PANEL.y + 32
    const selected = o === view.offset
    ctx.fillStyle = selected ? accent(o) : THEME.panel
    roundRectPath(ctx, x, y, 40, 38, 8)
    ctx.fill()
    ctx.strokeStyle = selected ? THEME.text : THEME.panelEdge
    ctx.lineWidth = selected ? 2 : 1
    ctx.stroke()
    ctx.lineWidth = 1
    ctx.textAlign = 'center'
    ctx.fillStyle = selected ? '#10101a' : THEME.text
    ctx.fillText(String(o), x + 20, y + 24)
  }
}

/**
 * 说明按钮（60x24 圆角）。
 * @param ctx - 画布上下文。
 * @param helpOpen - 当前是否展开帮助面板。
 */
function drawHelpButton(ctx: CanvasRenderingContext2D, helpOpen: boolean): void {
  ctx.fillStyle = helpOpen ? accent(4) : THEME.panel
  roundRectPath(ctx, HELP_BTN.x, HELP_BTN.y, HELP_BTN.w, HELP_BTN.h, 8)
  ctx.fill()
  ctx.strokeStyle = helpOpen ? THEME.text : THEME.panelEdge
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.textAlign = 'center'
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.fillStyle = helpOpen ? '#10101a' : THEME.text
  ctx.fillText(helpOpen ? '收起' : '说明', HELP_BTN.x + HELP_BTN.w / 2, HELP_BTN.y + 16)
}

/**
 * 帮助面板（15-16px 大字、行距 22px、8 行完整规则 + 易误解点）。
 * @param ctx - 画布上下文。
 */
function drawHelpPanel(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = 'rgba(13,13,20,0.74)'
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H)
  ctx.fillStyle = THEME.panel
  roundRectPath(ctx, HELP_PANEL.x, HELP_PANEL.y, HELP_PANEL.w, HELP_PANEL.h, 14)
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.textAlign = 'left'
  let y = HELP_PANEL.y + 32
  for (let i = 0; i < HELP_LINES.length; i += 1) {
    ctx.font = i === 0 ? 'bold 16px system-ui, sans-serif' : '500 15px system-ui, sans-serif'
    ctx.fillStyle = i === 0 ? THEME.text : THEME.textMuted
    ctx.fillText(HELP_LINES[i]!, HELP_PANEL.x + 20, y)
    y += 22
  }
}

/**
 * 遮罩文案（暂停 / 过关 / 未达标），null 表示无遮罩。
 */
function overlayText(view: SceneView): { title: string; subtitle: string; color: string } | null {
  if (view.paused) return { title: '暂停', subtitle: '按 P 继续 · R 重开本关', color: THEME.text }
  if (view.phase === 'won') {
    if (view.data.index >= 4) return { title: '全部通关', subtitle: '五幅纹样全部织成 · 点击回到第 1 关', color: THEME.gold }
    return { title: '过关', subtitle: '误差 ' + view.error + ' ≤ 容差 ' + view.data.tolerance + ' · 点击进入下一关', color: THEME.good }
  }
  if (view.phase === 'failed') {
    return { title: '未达标', subtitle: '误差 ' + view.error + ' > 容差 ' + view.data.tolerance + ' · 点击拆一行重织，或按 R 重开', color: THEME.bad }
  }
  return null
}

/**
 * 渲染一帧完整场景。末尾按最上层顺序：遮罩（暂停/过关/未达标）→ 粒子
 * → 说明按钮 + 帮助面板（任何阶段可开合）。
 * @param ctx - 画布上下文。
 * @param view - 本帧视图。
 * @param particles - 粒子系统（过关礼花）。
 * @param dtMs - 粒子推进毫秒。
 * @param helpOpen - 帮助面板是否展开。
 */
export function renderScene(
  ctx: CanvasRenderingContext2D,
  view: SceneView,
  particles: ParticleSystem,
  dtMs: number,
  helpOpen: boolean,
): void {
  drawBackground(ctx, LOGICAL_W, LOGICAL_H)
  ctx.textAlign = 'left'
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('织机穿梭', LOGICAL_W / 2 - 26, 26)
  hudPair(ctx, 16, 26, '关卡', view.hudLevel)
  hudPair(ctx, LOGICAL_W - 16, 26, '误差', view.error + '/' + view.data.tolerance, 'right', view.error <= view.data.tolerance ? THEME.good : THEME.bad)

  drawPanel(ctx, LOOM_PANEL)
  drawCloth(ctx, view, clothLayout(view.data))
  drawPreview(ctx, view)
  drawTarget(ctx, view)
  drawBasket(ctx, view)
  drawOffset(ctx, view)

  ctx.textAlign = 'center'
  ctx.font = '500 13px system-ui, sans-serif'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('点色线与偏移 · 回车织入 · Z 拆线 · R 重开 · P 暂停', LOGICAL_W / 2, 510)

  const overlay = overlayText(view)
  if (overlay !== null) drawOverlay(ctx, LOGICAL_W, LOGICAL_H, overlay.title, overlay.subtitle, overlay.color)
  particles.tick(ctx, dtMs)
  // 渲染函数末尾最上层：说明按钮 + 帮助面板。
  drawHelpButton(ctx, helpOpen)
  if (helpOpen) drawHelpPanel(ctx)
}

