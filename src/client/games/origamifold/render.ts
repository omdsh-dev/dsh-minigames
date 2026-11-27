/**
 * 折纸成方 OrigamiFold 渲染：工艺纸风画面——纸格按可见色铺色、格间
 * 折痕线、格角层数小字；折叠动画 250ms（翻折侧绕折线翻转并随盘面重
 * 居中平移，落点与逻辑映射严格一致）；悬停折线高亮「将被折过去的一
 * 半」；目标色/当前色徽章、关卡/尺寸/步数/最优 HUD；说明按钮（60×24
 * 右下角）与 15px 大字帮助面板画在整个渲染函数的最末尾，保证盖在盘
 * 面与遮罩之上、任何阶段可开合。
 *
 * 布局常量与命中函数全部导出，index.ts 用同一份布局做点击命中，杜绝
 * 绘制与命中错位。
 */
import { THEME, accent, glow, noGlow, roundRectPath, drawBackground, drawOverlay, hudPair } from '../theme.ts'
import { foldGeometry, listFolds, centerTopColor, type FoldMove, type FoldState, type Stack } from './logic.ts'

/** 逻辑画布尺寸（关卡间不变，自适应交给 fitCanvas 变换）。 */
export const LOGICAL_W = 960
export const LOGICAL_H = 600

/** 纸格边长（最大 6×6 = 420px，居中含上下边距）。 */
export const CELL = 70
/** 盘面可用纵向带（HUD 之下、说明按钮之上）。 */
const BOARD_TOP = 64
const BOARD_BOTTOM = 552

/** 一个矩形（逻辑坐标）。 */
export interface Rect { x: number, y: number, w: number, h: number }

/** 「说明」按钮矩形（60×24，右下角；渲染在最上层，index.ts 复用命中）。 */
export const HELP_BUTTON: Rect = { x: LOGICAL_W - 84, y: LOGICAL_H - 38, w: 60, h: 24 }

/** 折叠动画时长（秒）。 */
export const ANIM_S = 0.25

/** 颜色 id -> 纸面颜色（取色板中彼此拉开色相的三个）。 */
export function paperColor(id: number): string {
  return [THEME.accents[0]!, THEME.accents[2]!, THEME.accents[4]!][id] ?? accent(id)
}

/** 折叠动画：index.ts 推进 t（秒）；期间按旧盘面 + 翻转变换绘制。 */
export interface FoldAnim {
  /** 本次折叠。 */
  move: FoldMove
  /** 折前行数。 */
  oldRows: number
  /** 折前列数。 */
  oldCols: number
  /** 折前层叠网格（快照）。 */
  oldCells: Stack[][]
  /** 已播放秒数。 */
  t: number
}

/** 渲染选项：暂停、帮助面板、悬停折线、折叠动画、过关文案。 */
export interface OrigamiView {
  paused: boolean
  /** 说明面板是否展开。 */
  helpOpen: boolean
  /** 悬停的折叠（null 无）。 */
  hover: FoldMove | null
  /** 进行中的折叠动画（null 无）。 */
  anim: FoldAnim | null
  /** 过关遮罩副标题（null 用默认文案）。 */
  winText: string | null
}

/**
 * 当前尺寸的盘面矩形（居中含边距，尺寸自适应）。
 * @param rows - 当前行数。
 * @param cols - 当前列数。
 */
export function boardRect(rows: number, cols: number): Rect {
  const w = cols * CELL
  const h = rows * CELL
  return { x: (LOGICAL_W - w) / 2, y: BOARD_TOP + (BOARD_BOTTOM - BOARD_TOP - h) / 2, w, h }
}

/**
 * 命中测试：坐标是否点在某条合法折线附近（±12px），并按点击在线的
 * 哪一侧决定翻折侧（点哪侧、哪侧折过去）。
 * @param x - 逻辑横坐标。
 * @param y - 逻辑纵坐标。
 * @param rows - 当前行数。
 * @param cols - 当前列数。
 * @returns 折叠；不在任何合法折线附近返回 null。
 */
export function foldLineAt(x: number, y: number, rows: number, cols: number): FoldMove | null {
  const rect = boardRect(rows, cols)
  let best: FoldMove | null = null
  let bestDist = 13
  for (let k = 1; k < rows; k += 1) {
    if (Math.abs(2 * k - rows) > 1) continue
    const lineY = rect.y + k * CELL
    if (x < rect.x - 12 || x > rect.x + rect.w + 12) continue
    const dist = Math.abs(y - lineY)
    if (dist < bestDist) {
      bestDist = dist
      best = { axis: 'h', k, side: y < lineY ? 'a' : 'b' }
    }
  }
  for (let k = 1; k < cols; k += 1) {
    if (Math.abs(2 * k - cols) > 1) continue
    const lineX = rect.x + k * CELL
    if (y < rect.y - 12 || y > rect.y + rect.h + 12) continue
    const dist = Math.abs(x - lineX)
    if (dist < bestDist) {
      bestDist = dist
      best = { axis: 'v', k, side: x < lineX ? 'a' : 'b' }
    }
  }
  return best
}

/**
 * 说明按钮是否被点中。
 * @param x - 逻辑横坐标。
 * @param y - 逻辑纵坐标。
 */
export function helpButtonHit(x: number, y: number): boolean {
  return x >= HELP_BUTTON.x && x < HELP_BUTTON.x + HELP_BUTTON.w
    && y >= HELP_BUTTON.y && y < HELP_BUTTON.y + HELP_BUTTON.h
}

/** 画一个纸格：可见色铺面 + 折痕描边 + 层数小字（>1 层时）。 */
function drawCell(ctx: CanvasRenderingContext2D, stack: Stack, x: number, y: number): void {
  const top = stack[stack.length - 1]!
  roundRectPath(ctx, x + 2, y + 2, CELL - 4, CELL - 4, 5)
  ctx.fillStyle = paperColor(top)
  ctx.globalAlpha = 0.92
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.strokeStyle = 'rgba(21,21,27,0.35)'
  ctx.lineWidth = 1
  ctx.stroke()
  // 纸纹：恒定斜向两道浅线（按下标错落感由位置天然提供）。
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'
  ctx.beginPath()
  ctx.moveTo(x + 10, y + CELL - 12)
  ctx.lineTo(x + CELL - 12, y + 10)
  ctx.moveTo(x + 12, y + CELL - 26)
  ctx.lineTo(x + CELL - 26, y + 12)
  ctx.stroke()
  if (stack.length > 1) {
    ctx.font = '600 10px system-ui, sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = 'rgba(21,21,27,0.62)'
    ctx.fillText(String(stack.length) + '层', x + CELL - 7, y + CELL - 7)
  }
}

/** 画整张纸（盘面底板 + 每格），格间折痕线。 */
function drawPaper(ctx: CanvasRenderingContext2D, cells: Stack[][], rows: number, cols: number, rect: Rect): void {
  glow(ctx, 'rgba(0,0,0,0.5)', 14)
  roundRectPath(ctx, rect.x - 3, rect.y - 3, rect.w + 6, rect.h + 6, 9)
  ctx.fillStyle = THEME.panel
  ctx.fill()
  noGlow(ctx)
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      drawCell(ctx, cells[r]![c]!, rect.x + c * CELL, rect.y + r * CELL)
    }
  }
}

/** 画合法折线指示（虚线 + 两端小三角），悬停时实线高亮。 */
function drawFoldLines(ctx: CanvasRenderingContext2D, rows: number, cols: number, rect: Rect, hover: FoldMove | null): void {
  const drawLine = (vertical: boolean, k: number, hot: boolean): void => {
    const pos = (vertical ? rect.x : rect.y) + k * CELL
    ctx.save()
    ctx.strokeStyle = hot ? THEME.text : 'rgba(226,226,238,0.34)'
    ctx.lineWidth = hot ? 2.5 : 1.5
    if (!hot) ctx.setLineDash([7, 7])
    ctx.beginPath()
    if (vertical) {
      ctx.moveTo(pos, rect.y - 6)
      ctx.lineTo(pos, rect.y + rect.h + 6)
    } else {
      ctx.moveTo(rect.x - 6, pos)
      ctx.lineTo(rect.x + rect.w + 6, pos)
    }
    ctx.stroke()
    ctx.restore()
  }
  for (const move of listFolds(rows, cols)) {
    // 每条折线的两个翻折侧共用同一条线：只画一次（同 k 同 axis 去重）。
    if (move.side === 'b') continue
    const hot = hover !== null && hover.axis === move.axis && hover.k === move.k
    drawLine(move.axis === 'v', move.k, hot)
  }
}

/** 悬停提示：给「将被折过去的一半」铺一层浅色蒙版 + 折线一侧箭头。 */
function drawHoverHalf(ctx: CanvasRenderingContext2D, rect: Rect, rows: number, cols: number, hover: FoldMove): void {
  const geo = foldGeometry(hover.axis === 'v' ? cols : rows, hover.k, hover.side)
  if (geo === null) return
  ctx.save()
  ctx.fillStyle = 'rgba(226,226,238,0.10)'
  if (hover.axis === 'v') {
    const x = rect.x + geo.foldStart * CELL
    ctx.fillRect(x, rect.y, (geo.foldEnd - geo.foldStart) * CELL, rect.h)
  } else {
    const y = rect.y + geo.foldStart * CELL
    ctx.fillRect(rect.x, y, rect.w, (geo.foldEnd - geo.foldStart) * CELL)
  }
  ctx.restore()
}

/** 徽章：面板 + 标签 + 色块（目标色 / 当前可见色）。 */
function drawBadge(ctx: CanvasRenderingContext2D, rect: Rect, label: string, color: string, hot: boolean): void {
  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 7)
  ctx.fillStyle = THEME.panel
  ctx.fill()
  ctx.strokeStyle = hot ? color : THEME.panelEdge
  ctx.lineWidth = hot ? 2 : 1
  ctx.stroke()
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText(label, rect.x + 12, rect.y + 19)
  ctx.fillStyle = color
  glow(ctx, color, hot ? 10 : 4)
  roundRectPath(ctx, rect.x + rect.w - 30, rect.y + 6, 18, 16, 4)
  ctx.fill()
  noGlow(ctx)
}

/** 帮助面板正文（15px 大字，宽 720px 面板逐行核算）。 */
const HELP_LINES = [
  'N×N 彩纸：点击折线，把其中一半折过去——上层颜色会盖住下层。',
  '折线必须「恰好对折」：两侧格数相等；奇数尺寸差 1（多的一侧翻过去伸出成新边）。',
  '点折线的哪一侧，哪一侧就折过去盖在另一侧上——折哪一侧决定最终露出什么色。',
  '每次折后该方向格数减半（向上取整）：4→2→1、5→3→2→1，折成 1×1 才结算。',
  '格角小字 = 该处层数；1×1 时看最上层颜色，等于目标色即过关。',
  '总折叠次数是定值（4×4 共 4 折、5×5 与 6×6 共 6 折），胜负全在左右/上下侧的选择。',
  '折错了按 Z 回退一步（不可跨关、结算后不可退）；卡死也可 Z 逐步退回再选。',
  'Z 回退 · R 重开 · P 暂停 · H / 右下角「说明」随时开合（暂停时也能看）。',
]

/**
 * 整幅渲染：背景 → HUD（含目标/当前徽章）→ 盘面（静止或折叠动画中）
 * → 折线指示与悬停蒙版 → 粒子 → 暂停/过关/卡死遮罩 → 说明按钮 →
 * 帮助面板（最后两步永远最上层，任何阶段可开合）。
 * @param ctx - 画布上下文（fitCanvas 已做逻辑坐标变换）。
 * @param state - 对局状态。
 * @param view - 渲染选项。
 * @param particles - 可选粒子系统（过关庆祝）。
 * @param dtMs - 本帧毫秒（粒子推进用）。
 */
export function renderOrigami(
  ctx: CanvasRenderingContext2D,
  state: FoldState,
  view: OrigamiView,
  particles?: { tick(ctx: CanvasRenderingContext2D, dtMs: number): void },
  dtMs = 16,
): void {
  drawBackground(ctx, LOGICAL_W, LOGICAL_H)

  // HUD 布局（同一水平带 y=26 基线，锚点间距见报告核算）：
  // 左三对 24/150/290；居中提示 480；右锚「最优」620；两枚徽章
  // 640-780 / 800-940，互不相交、不越 LOGICAL_W。
  ctx.textBaseline = 'alphabetic'
  hudPair(ctx, 24, 26, '关卡', (state.level + 1) + '/' + 5)
  hudPair(ctx, 150, 26, '尺寸', state.rows + '×' + state.cols)
  hudPair(ctx, 290, 26, '步数', String(state.folds))
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('点击折线对折 · 折成 1×1', LOGICAL_W / 2, 26)
  hudPair(ctx, 620, 26, '最优', String(state.optimalFolds), 'right', THEME.gold)
  drawBadge(ctx, { x: 640, y: 12, w: 140, h: 28 }, '目标', paperColor(state.target), state.status === 'won')
  const currentColor = centerTopColor(state)
  drawBadge(ctx, { x: 800, y: 12, w: 140, h: 28 }, '当前', paperColor(currentColor),
    state.rows === 1 && state.cols === 1 && currentColor === state.target)

  // 盘面分派（三态显式分支）：
  //   折叠动画中 → 旧盘面快照 + 翻折侧绕折线翻转（scale=cosπp）+ 整体
  //     随重居中平移 originShift·p，p=1 时落点与逻辑映射一致；
  //   静止 playing/won/lost → 当前盘面原样绘制（1×1 单格照画，遮罩随后）。
  const animating = view.anim !== null && view.anim.t < ANIM_S
  if (animating && view.anim !== null) {
    const a = view.anim
    const geo = foldGeometry(a.move.axis === 'v' ? a.oldCols : a.oldRows, a.move.k, a.move.side)
    if (geo !== null) {
      const rect = boardRect(a.oldRows, a.oldCols)
      const p = Math.max(0, Math.min(1, a.t / ANIM_S))
      const flip = Math.cos(Math.PI * p)
      const shift = geo.originShift * CELL * p
      ctx.save()
      ctx.translate(a.move.axis === 'v' ? shift : 0, a.move.axis === 'h' ? shift : 0)
      // 不动侧：原位平移绘制。
      for (let r = 0; r < a.oldRows; r += 1) {
        for (let c = 0; c < a.oldCols; c += 1) {
          const index = a.move.axis === 'v' ? c : r
          if (index < geo.stationStart || index >= geo.stationEnd) continue
          drawCell(ctx, a.oldCells[r]![c]!, rect.x + c * CELL, rect.y + r * CELL)
        }
      }
      // 翻折侧：绕折线翻转绘制（负 scale 同时完成镜像，p=1 即目标位）。
      ctx.save()
      if (a.move.axis === 'v') {
        const fx = rect.x + a.move.k * CELL
        ctx.translate(fx, 0)
        ctx.scale(flip, 1)
        ctx.translate(-fx, 0)
      } else {
        const fy = rect.y + a.move.k * CELL
        ctx.translate(0, fy)
        ctx.scale(1, flip)
        ctx.translate(0, -fy)
      }
      for (let r = 0; r < a.oldRows; r += 1) {
        for (let c = 0; c < a.oldCols; c += 1) {
          const index = a.move.axis === 'v' ? c : r
          if (index < geo.foldStart || index >= geo.foldEnd) continue
          ctx.globalAlpha = 0.92 - 0.18 * Math.abs(flip)
          drawCell(ctx, a.oldCells[r]![c]!, rect.x + c * CELL, rect.y + r * CELL)
          ctx.globalAlpha = 1
        }
      }
      ctx.restore()
      ctx.restore()
      // 折边高光：折线当前位置一道亮线（随翻转略暗）。
      ctx.strokeStyle = 'rgba(226,226,238,' + (0.6 - 0.3 * p) + ')'
      ctx.lineWidth = 2
      ctx.beginPath()
      if (a.move.axis === 'v') {
        const fx = rect.x + a.move.k * CELL + shift
        ctx.moveTo(fx, rect.y - 6)
        ctx.lineTo(fx, rect.y + rect.h + 6)
      } else {
        const fy = rect.y + a.move.k * CELL + shift
        ctx.moveTo(rect.x - 6, fy)
        ctx.lineTo(rect.x + rect.w + 6, fy)
      }
      ctx.stroke()
    }
  } else {
    const rect = boardRect(state.rows, state.cols)
    drawPaper(ctx, state.cells, state.rows, state.cols, rect)
    if (state.status === 'playing' && !view.paused) {
      drawFoldLines(ctx, state.rows, state.cols, rect, view.hover)
      if (view.hover !== null) drawHoverHalf(ctx, rect, state.rows, state.cols, view.hover)
    }
  }

  particles?.tick(ctx, dtMs)

  if (view.paused) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '暂停', '按 P 继续折纸', THEME.gold)
  } else if (state.status === 'won') {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '折纸成方', view.winText ?? '1×1 顶色 = 目标色', THEME.good)
  } else if (state.status === 'lost') {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '色不对', '顶色不符 · 按 R 重开本关', THEME.bad)
  }

  drawHelpButton(ctx, view.helpOpen)
  if (view.helpOpen) drawHelpPanel(ctx)
}

/** 说明按钮（渲染末尾、最上层）。 */
function drawHelpButton(ctx: CanvasRenderingContext2D, open: boolean): void {
  const rect = HELP_BUTTON
  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 6)
  ctx.fillStyle = open ? paperColor(1) : THEME.panel
  ctx.fill()
  ctx.strokeStyle = open ? paperColor(1) : THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = open ? '#15151b' : THEME.text
  ctx.fillText(open ? '关闭' : '说明', rect.x + rect.w / 2, rect.y + 16)
}

/** 帮助面板（渲染最末尾、最上层；15px 大字 8 行完整规则）。 */
function drawHelpPanel(ctx: CanvasRenderingContext2D): void {
  const w = 720
  const h = HELP_LINES.length * 28 + 56
  const x = (LOGICAL_W - w) / 2
  const y = 108
  roundRectPath(ctx, x, y, w, h, 12)
  ctx.fillStyle = 'rgba(20,20,30,0.96)'
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.font = 'bold 17px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = THEME.text
  ctx.fillText('折纸成方 · 完整玩法', x + w / 2, y + 32)
  ctx.font = '600 15px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = THEME.text
  for (let i = 0; i < HELP_LINES.length; i += 1) {
    ctx.fillText(HELP_LINES[i]!, x + 28, y + 62 + i * 28)
  }
}
