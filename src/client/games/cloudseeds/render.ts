/**
 * 云中播种渲染：农田天空风画面——天空流场箭头（沿风向漂移动画）、
 * 云朵飘浮（加速 » / 减速 «）、山剪影、田地格（浇灌后变深绿+水珠）、
 * 种子飘行轨迹虚线、飞行种子光点、浇灌水滴粒子、HUD 进度、说明按钮
 * 与帮助面板。纯绘制 + 布局导出（index.ts 用同一份布局做点击命中，
 * 杜绝绘制与命中错位）。说明按钮与帮助面板画在整个渲染函数的最末尾，
 * 保证盖在棋盘与 overlay 之上；任何阶段都可开合。
 */
import {
  CELL_CLOUD_FAST, CELL_CLOUD_SLOW, CELL_FIELD, CELL_MOUNTAIN,
  type CloudSeedsLevel, type SeedFlight, type SeedOutcome,
} from './logic.ts'
import { THEME, glow, noGlow, roundRectPath, drawBackground, drawOverlay, hudPair } from '../theme.ts'

/** 逻辑画布尺寸（关卡间不变，自适应交给 fitCanvas 变换）。 */
export const LOGICAL_W = 960
export const LOGICAL_H = 580

/** 棋盘纵向可用带（上下留白给 HUD 与底部提示）。 */
const BOARD_TOP = 64
const BOARD_BOTTOM = 540
const BOARD_SIDE = 32

/** 一个矩形（逻辑坐标）。 */
export interface Rect { x: number, y: number, w: number, h: number }

/** 布局：棋盘矩形、格边长、说明按钮。 */
export interface CloudLayout {
  /** 棋盘整体矩形（含四周留白已扣除）。 */
  board: Rect
  /** 单格边长。 */
  cell: number
  /** 说明按钮（60×24，右下角）。 */
  helpButton: Rect
}

/**
 * 计算整幅布局（绘制与命中共用）：格边长按盘面自适应，棋盘居中。
 * @param level - 盘面。
 * @returns 完整布局矩形。
 */
export function computeLayout(level: CloudSeedsLevel): CloudLayout {
  const cell = Math.min(
    Math.floor((LOGICAL_W - BOARD_SIDE * 2) / level.cols),
    Math.floor((BOARD_BOTTOM - BOARD_TOP) / level.rows),
  )
  const boardW = cell * level.cols
  const boardH = cell * level.rows
  return {
    board: {
      x: Math.floor((LOGICAL_W - boardW) / 2),
      y: BOARD_TOP + Math.floor((BOARD_BOTTOM - BOARD_TOP - boardH) / 2),
      w: boardW,
      h: boardH,
    },
    cell,
    helpButton: { x: LOGICAL_W - 84, y: LOGICAL_H - 38, w: 60, h: 24 },
  }
}

/**
 * 命中棋盘格。
 * @param layout - 布局。
 * @param level - 盘面。
 * @param x - 逻辑横坐标。
 * @param y - 逻辑纵坐标。
 * @returns 格下标，未命中返回 -1。
 */
export function cellAt(layout: CloudLayout, level: CloudSeedsLevel, x: number, y: number): number {
  const b = layout.board
  if (x < b.x || y < b.y || x >= b.x + b.w || y >= b.y + b.h) return -1
  const col = Math.floor((x - b.x) / layout.cell)
  const row = Math.floor((y - b.y) / layout.cell)
  return row * level.cols + col
}

/**
 * 某格中心点（轨迹/粒子/高亮定位用）。
 * @param layout - 布局。
 * @param level - 盘面。
 * @param cell - 格下标。
 */
export function cellCenter(layout: CloudLayout, level: CloudSeedsLevel, cell: number): { x: number, y: number } {
  const r = Math.floor(cell / level.cols)
  const c = cell % level.cols
  return {
    x: layout.board.x + (c + 0.5) * layout.cell,
    y: layout.board.y + (r + 0.5) * layout.cell,
  }
}

/**
 * 说明按钮是否被点中。
 * @param layout - 布局。
 * @param x - 逻辑横坐标。
 * @param y - 逻辑纵坐标。
 */
export function helpButtonHit(layout: CloudLayout, x: number, y: number): boolean {
  const h = layout.helpButton
  return x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h
}

/** 风向箭头字符。 */
function windArrow(dx: number, dy: number): string {
  if (dx === 1 && dy === 0) return '→'
  if (dx === -1 && dy === 0) return '←'
  if (dx === 0 && dy === 1) return '↓'
  if (dx === 0 && dy === -1) return '↑'
  if (dx === 1 && dy === 1) return '↘'
  if (dx === 1 && dy === -1) return '↗'
  if (dx === -1 && dy === 1) return '↙'
  return '↖'
}

/** 已完成的一次飘行轨迹（渲染历史虚线）。 */
export interface SeedTrail {
  /** 途经格（含起点）。 */
  path: number[]
  /** 结果。 */
  outcome: SeedOutcome
  /** 新浇灌的田数（0 表示白丢一颗）。 */
  wateredCount: number
}

/** 渲染选项：进度、悬停、预览、飞行、历史轨迹与阶段标志。 */
export interface RenderOptions {
  /** 关卡显示号（1 基）。 */
  level: number
  /** 剩余种子。 */
  seedsLeft: number
  /** 已浇灌田数。 */
  wateredTotal: number
  /** 田地总数。 */
  fieldsTotal: number
  /** 已浇灌标记（行主序）。 */
  watered: Uint8Array
  /** 悬停格（-1 无）。 */
  hover: number
  /** 空格试放的轨迹预览（不消耗种子）。 */
  preview: SeedFlight | null
  /** 飞行中的种子（含进度 t∈[0,1]）。 */
  flying: { flight: SeedFlight, t: number } | null
  /** 历史轨迹。 */
  trails: SeedTrail[]
  /** 暂停中。 */
  paused: boolean
  /** 已过关。 */
  won: boolean
  /** 已失败（种子用尽）。 */
  lost: boolean
  /** 过关文案。 */
  winText: string | null
  /** 说明面板是否展开。 */
  helpOpen: boolean
  /** 动画时钟（秒，流场与云朵漂移）。 */
  timeSec: number
}

/** 画天空格底色（两色棋盘微差）。 */
function drawSkyCell(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, row: number, col: number): void {
  ctx.fillStyle = (row + col) % 2 === 0 ? 'rgba(122,162,247,0.05)' : 'rgba(122,162,247,0.10)'
  ctx.fillRect(x, y, s, s)
}

/** 画田地格：未浇灌浅绿描边，浇灌后深绿实底加水珠。 */
function drawFieldCell(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, watered: boolean): void {
  if (watered) {
    ctx.fillStyle = 'rgba(94,158,58,0.92)'
    ctx.fillRect(x + 2, y + 2, s - 4, s - 4)
    ctx.fillStyle = 'rgba(125,207,255,0.9)'
    for (let d = 0; d < 3; d += 1) {
      ctx.beginPath()
      ctx.arc(x + s * (0.32 + d * 0.18), y + s * 0.5 + Math.sin(d * 2.1) * s * 0.14, s * 0.05, 0, Math.PI * 2)
      ctx.fill()
    }
  } else {
    ctx.fillStyle = 'rgba(158,206,106,0.22)'
    ctx.fillRect(x + 2, y + 2, s - 4, s - 4)
    ctx.strokeStyle = 'rgba(158,206,106,0.65)'
    ctx.lineWidth = 1.5
    ctx.strokeRect(x + 2.5, y + 2.5, s - 5, s - 5)
    ctx.strokeStyle = 'rgba(158,206,106,0.45)'
    ctx.beginPath()
    ctx.moveTo(x + s * 0.25, y + s * 0.75)
    ctx.lineTo(x + s * 0.5, y + s * 0.3)
    ctx.lineTo(x + s * 0.75, y + s * 0.75)
    ctx.stroke()
  }
}

/** 画云朵：三团圆绒 + 呼吸式水平漂移 + 速度角标（»/«）。 */
function drawCloudCell(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, fast: boolean, timeSec: number, cellIndex: number): void {
  const drift = Math.sin(timeSec * 0.9 + cellIndex * 1.7) * s * 0.06
  const cx = x + s / 2 + drift
  const cy = y + s / 2
  ctx.fillStyle = fast ? 'rgba(125,207,255,0.20)' : 'rgba(200,214,240,0.16)'
  glow(ctx, fast ? '#7dcfff' : '#a9b1d6', 8)
  ctx.beginPath()
  ctx.arc(cx - s * 0.18, cy + s * 0.05, s * 0.16, 0, Math.PI * 2)
  ctx.arc(cx, cy - s * 0.06, s * 0.21, 0, Math.PI * 2)
  ctx.arc(cx + s * 0.18, cy + s * 0.04, s * 0.15, 0, Math.PI * 2)
  ctx.fill()
  noGlow(ctx)
  ctx.font = 'bold ' + Math.floor(s * 0.22) + 'px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = fast ? '#7dcfff' : 'rgba(226,226,238,0.75)'
  ctx.fillText(fast ? '»' : '«', cx, y + s - 6)
}

/** 画山剪影：主峰+副峰三角。 */
function drawMountainCell(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.fillStyle = '#3a3a50'
  ctx.beginPath()
  ctx.moveTo(x + 3, y + s - 3)
  ctx.lineTo(x + s * 0.42, y + 4)
  ctx.lineTo(x + s * 0.7, y + s - 3)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#2c2c40'
  ctx.beginPath()
  ctx.moveTo(x + s * 0.55, y + s - 3)
  ctx.lineTo(x + s * 0.78, y + s * 0.38)
  ctx.lineTo(x + s - 3, y + s - 3)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = '#5a5a76'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x + 3, y + s - 3)
  ctx.lineTo(x + s * 0.42, y + 4)
  ctx.lineTo(x + s * 0.7, y + s - 3)
  ctx.stroke()
}

/** 画天空流场箭头：沿风向漂移的两枚小箭头，表达风的走向。 */
function drawFlowArrow(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, dx: number, dy: number, timeSec: number, cellIndex: number): void {
  const phase = (timeSec * s * 0.28 + cellIndex * 29) % s
  for (let k = 0; k < 2; k += 1) {
    const off = (phase + k * s * 0.5) % s - s * 0.5
    const ax = x + s * 0.5 + dx * off
    const ay = y + s * 0.5 + dy * off
    const len = s * 0.16
    ctx.strokeStyle = 'rgba(122,162,247,0.22)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(ax - dx * len, ay - dy * len)
    ctx.lineTo(ax + dx * len, ay + dy * len)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(ax + dx * len, ay + dy * len)
    ctx.lineTo(ax + dx * len - (dx + -dy) * len * 0.4, ay + dy * len - (dy + dx) * len * 0.4)
    ctx.moveTo(ax + dx * len, ay + dy * len)
    ctx.lineTo(ax + dx * len - (dx - -dy) * len * 0.4, ay + dy * len - (dy - dx) * len * 0.4)
    ctx.stroke()
  }
}

/** 沿轨迹画虚线（预览/历史共用，颜色与线宽由调用方给定）。 */
function drawFlightPath(ctx: CanvasRenderingContext2D, layout: CloudLayout, level: CloudSeedsLevel, path: number[], color: string, width: number): void {
  if (path.length < 2) return
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.setLineDash([7, 6])
  ctx.beginPath()
  for (let i = 0; i < path.length; i += 1) {
    const p = cellCenter(layout, level, path[i]!)
    if (i === 0) ctx.moveTo(p.x, p.y)
    else ctx.lineTo(p.x, p.y)
  }
  ctx.stroke()
  ctx.setLineDash([])
}

/** 画落点标记：好=金圈，坏=红叉。 */
function drawLandingMark(ctx: CanvasRenderingContext2D, x: number, y: number, flight: SeedFlight): void {
  if (flight.outcome === 'landed') {
    ctx.strokeStyle = THEME.gold
    ctx.lineWidth = 2.5
    glow(ctx, THEME.gold, 10)
    ctx.beginPath()
    ctx.arc(x, y, 10, 0, Math.PI * 2)
    ctx.stroke()
    noGlow(ctx)
  } else {
    ctx.strokeStyle = THEME.bad
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(x - 8, y - 8)
    ctx.lineTo(x + 8, y + 8)
    ctx.moveTo(x + 8, y - 8)
    ctx.lineTo(x - 8, y + 8)
    ctx.stroke()
  }
}

/**
 * 整幅渲染：背景 → HUD → 棋盘（天空流场/云/山/田/悬停/历史轨迹/预览/
 * 飞行种子）→ 底部提示 → 粒子 → 暂停/过关/失败 overlay → 说明按钮 →
 * 帮助面板（最后两步永远最上层）。
 * @param ctx - 画布上下文（fitCanvas 变换后的逻辑坐标）。
 * @param level - 盘面。
 * @param opts - 渲染选项。
 * @param particles - 可选粒子系统（浇灌时 index.ts 注入）。
 * @param dtMs - 粒子推进毫秒。
 */
export function renderCloudSeeds(
  ctx: CanvasRenderingContext2D,
  level: CloudSeedsLevel,
  opts: RenderOptions,
  particles?: { tick(ctx: CanvasRenderingContext2D, dtMs: number): void },
  dtMs = 16,
): void {
  const layout = computeLayout(level)
  drawBackground(ctx, LOGICAL_W, LOGICAL_H)
  ctx.textBaseline = 'alphabetic'

  // HUD 左组：关卡、种子；右组：田地进度、风向（右锚定宽，列距充足）。
  hudPair(ctx, 24, 26, '关卡', opts.level + '/' + 5)
  hudPair(ctx, 170, 26, '种子', String(opts.seedsLeft))
  hudPair(ctx, LOGICAL_W - 24, 26, '田地', opts.wateredTotal + '/' + opts.fieldsTotal, 'right',
    opts.wateredTotal === opts.fieldsTotal ? THEME.good : THEME.text)
  hudPair(ctx, LOGICAL_W - 240, 26, '风', windArrow(level.wind.dx, level.wind.dy), 'right', '#7dcfff')

  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('» 加速云：预算耗得快、飞得近 · « 减速云：飞得远 · 点天空/云格播种', 24, 52)

  // 棋盘。
  const s = layout.cell
  for (let r = 0; r < level.rows; r += 1) {
    for (let c = 0; c < level.cols; c += 1) {
      const i = r * level.cols + c
      const x = layout.board.x + c * s
      const y = layout.board.y + r * s
      const kind = level.cells[i]
      if (kind === CELL_MOUNTAIN) {
        drawMountainCell(ctx, x, y, s)
        continue
      }
      if (kind === CELL_FIELD) {
        drawFieldCell(ctx, x, y, s, opts.watered[i] === 1)
        continue
      }
      drawSkyCell(ctx, x, y, s, r, c)
      if (kind === CELL_CLOUD_FAST) drawCloudCell(ctx, x, y, s, true, opts.timeSec, i)
      else if (kind === CELL_CLOUD_SLOW) drawCloudCell(ctx, x, y, s, false, opts.timeSec, i)
      else drawFlowArrow(ctx, x, y, s, level.wind.dx, level.wind.dy, opts.timeSec, i)
    }
  }

  // 悬停高亮（可播格描一圈蓝边）。
  if (opts.hover >= 0) {
    const hr = Math.floor(opts.hover / level.cols)
    const hc = opts.hover % level.cols
    const x = layout.board.x + hc * s
    const y = layout.board.y + hr * s
    ctx.strokeStyle = 'rgba(122,162,247,0.85)'
    ctx.lineWidth = 2
    ctx.strokeRect(x + 1, y + 1, s - 2, s - 2)
  }

  // 历史轨迹（淡）。
  for (const trail of opts.trails) {
    const color = trail.outcome !== 'landed'
      ? 'rgba(247,118,142,0.35)'
      : trail.wateredCount > 0 ? 'rgba(158,206,106,0.4)' : 'rgba(226,226,238,0.25)'
    drawFlightPath(ctx, layout, level, trail.path, color, 1.5)
  }

  // 空格预览：亮虚线 + 落点标记。
  if (opts.preview !== null) {
    drawFlightPath(ctx, layout, level, opts.preview.path, 'rgba(125,207,255,0.9)', 2)
    if (opts.preview.outcome === 'landed') {
      const p = cellCenter(layout, level, opts.preview.landing)
      drawLandingMark(ctx, p.x, p.y, opts.preview)
    } else {
      const last = opts.preview.path[opts.preview.path.length - 1]!
      const p = cellCenter(layout, level, last)
      drawLandingMark(ctx, p.x, p.y, opts.preview)
    }
  }

  // 飞行中的种子：沿轨迹插值的光点 + 尾迹。
  if (opts.flying !== null) {
    const f = opts.flying.flight
    const t = Math.min(1, Math.max(0, opts.flying.t))
    const seg = t * (f.path.length - 1)
    const i0 = Math.min(f.path.length - 1, Math.floor(seg))
    const i1 = Math.min(f.path.length - 1, i0 + 1)
    const frac = seg - i0
    const a = cellCenter(layout, level, f.path[i0]!)
    const b = cellCenter(layout, level, f.path[i1]!)
    const px = a.x + (b.x - a.x) * frac
    const py = a.y + (b.y - a.y) * frac
    drawFlightPath(ctx, layout, level, f.path, 'rgba(224,175,104,0.55)', 2)
    ctx.fillStyle = THEME.gold
    glow(ctx, THEME.gold, 14)
    ctx.beginPath()
    ctx.arc(px, py, 6, 0, Math.PI * 2)
    ctx.fill()
    noGlow(ctx)
  }

  // 底部提示（居中，与右下说明按钮不相交）。
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('点天空/云格播种 · 空格 预览轨迹 · R 重开 · P 暂停', LOGICAL_W / 2, 562)

  particles?.tick(ctx, dtMs)

  if (opts.paused) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '暂停', '按 P 继续 · 风与云仍在等你')
  } else if (opts.won) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '过关', opts.winText ?? '全部田地已浇灌', THEME.good)
  } else if (opts.lost) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '种子用尽', '还有田没浇到 · 按 R 重试本关', THEME.bad)
  }

  // 说明按钮（60×24，右下角）。
  const hb = layout.helpButton
  roundRectPath(ctx, hb.x, hb.y, hb.w, hb.h, 6)
  ctx.fillStyle = THEME.panel
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = opts.helpOpen ? '#7dcfff' : THEME.text
  ctx.fillText('说明', hb.x + hb.w / 2, hb.y + 16)

  // 帮助面板（模态，最上层）：15px 大字 7 行完整规则。
  if (opts.helpOpen) {
    const panelX = 190
    const panelY = 96
    const panelW = 580
    const panelH = 400
    roundRectPath(ctx, panelX, panelY, panelW, panelH, 10)
    ctx.fillStyle = 'rgba(30,30,42,0.96)'
    ctx.fill()
    ctx.strokeStyle = THEME.panelEdge
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.font = 'bold 18px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = THEME.text
    ctx.fillText('云中播种 · 玩法说明', panelX + panelW / 2, panelY + 38)
    ctx.font = '600 15px system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillStyle = THEME.text
    const lines = [
      '目标：在种子预算内，把盘面上所有田地格浇成深绿。',
      '点击天空格或云朵格播种，种子沿本关风向恒定飘行。',
      '飞行预算耗尽时落在当前格，浇灌落点周围 3×3 的田地。',
      '»加速云让预算耗得更快（飞得更近）；«减速云相反。',
      '飘出盘面或撞上山，这颗种子就白白损失，不浇任何田。',
      '按空格预览悬停格的完整轨迹（不消耗种子），先看后播。',
      'R 重开本关，P 暂停；再点一次「说明」即可关闭本面板。',
    ]
    for (let i = 0; i < lines.length; i += 1) {
      ctx.fillText(lines[i]!, panelX + 28, panelY + 74 + i * 27)
    }
    ctx.font = '600 13px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = THEME.textMuted
    ctx.fillText('任何阶段（暂停/过关/失败）都可以打开本说明', panelX + panelW / 2, panelY + panelH - 20)
  }
}

