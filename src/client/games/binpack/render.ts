/**
 * 装箱谜题 BinPack 渲染：仓库风画面——待装物品按体积比例成块、箱子为
 * 带余量条的货柜矩形。纯绘制 + 布局导出（index.ts 用同一份布局做点击
 * 命中，杜绝绘制与命中错位）。说明按钮与帮助面板画在整个渲染函数的
 * 最末尾，保证盖在棋盘与 overlay 之上。
 */
import { THEME, accent, glow, noGlow, roundRectPath, drawBackground, drawOverlay, hudPair } from '../theme.ts'
import { binLoad, type BinPackState } from './logic.ts'

/** 逻辑画布尺寸（关卡间不变，自适应交给 fitCanvas 变换）。 */
export const LOGICAL_W = 960
export const LOGICAL_H = 580

/** 一个矩形（逻辑坐标）。 */
export interface Rect { x: number, y: number, w: number, h: number }

/** 布局：待装区物品块、箱矩形、箱内物品块、说明按钮。 */
export interface BinPackLayout {
  /** 待装区每个物品的矩形（index = 物品下标）。 */
  tray: Rect[]
  /** 每个箱的矩形（index = 箱下标）。 */
  bins: Rect[]
  /** 箱内物品矩形，第一维箱下标、第二维按绘制顺序。 */
  binItems: Rect[][]
  /** 说明按钮（60x24，右下角）。 */
  helpButton: Rect
}

const TRAY_Y = 62
const ITEM_H = 36
const ITEM_GAP = 10
const BIN_COLS = 4
const BIN_W = 220
const BIN_H = 150
const BIN_GAP = 12
const BIN_Y = 190

/**
 * 计算整幅布局（绘制与命中共用）。
 * @param state - 对局状态。
 * @returns 完整布局矩形。
 */
export function computeLayout(state: BinPackState): BinPackLayout {
  const tray: Rect[] = []
  const items = state.level.items
  let x = 24
  let y = TRAY_Y
  for (let i = 0; i < items.length; i += 1) {
    const w = items[i]! * 14 + 14
    if (x + w > LOGICAL_W - 24) {
      x = 24
      y += ITEM_H + ITEM_GAP
    }
    tray[i] = { x, y, w, h: ITEM_H }
    x += w + ITEM_GAP
  }

  const bins: Rect[] = []
  for (let b = 0; b < state.binCount; b += 1) {
    const col = b % BIN_COLS
    const row = Math.floor(b / BIN_COLS)
    bins[b] = {
      x: 22 + col * (BIN_W + BIN_GAP),
      y: BIN_Y + row * (BIN_H + BIN_GAP),
      w: BIN_W,
      h: BIN_H,
    }
  }

  const binItems: Rect[][] = []
  for (let b = 0; b < state.binCount; b += 1) {
    const box = bins[b]!
    const inner = box.w - 20
    let ix = box.x + 10
    let iy = box.y + 34
    const row: Rect[] = []
    for (let i = 0; i < items.length; i += 1) {
      if (state.binOf[i] !== b) continue
      const w = Math.max(24, Math.round((items[i]! / state.level.capacity) * inner))
      if (ix + w > box.x + box.w - 10) {
        ix = box.x + 10
        iy += 30
      }
      if (iy + 26 <= box.y + box.h - 46) row.push({ x: ix, y: iy, w, h: 26 })
      ix += w + 6
    }
    binItems[b] = row
  }

  return {
    tray,
    bins,
    binItems,
    helpButton: { x: LOGICAL_W - 84, y: LOGICAL_H - 38, w: 60, h: 24 },
  }
}

/** 点是否落在矩形内。 */
function inside(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h
}

/**
 * 命中待装区物品。
 * @returns 物品下标，未命中返回 -1。
 */
export function trayItemAt(layout: BinPackLayout, state: BinPackState, x: number, y: number): number {
  for (let i = 0; i < layout.tray.length; i += 1) {
    if (state.binOf[i]! < 0 && inside(layout.tray[i]!, x, y)) return i
  }
  return -1
}

/**
 * 命中箱内物品。
 * @returns 物品下标，未命中返回 -1。
 */
export function binItemAt(layout: BinPackLayout, state: BinPackState, x: number, y: number): number {
  for (let b = 0; b < layout.binItems.length; b += 1) {
    // 与 computeLayout 相同的顺序遍历：第 n 个矩形属于箱内第 n 个物品
    let n = -1
    for (let k = 0; k < state.level.items.length; k += 1) {
      if (state.binOf[k] !== b) continue
      n += 1
      const rect = layout.binItems[b]![n]
      if (rect !== undefined && inside(rect, x, y)) return k
    }
  }
  return -1
}



/**
 * 命中箱矩形。
 * @returns 箱下标，未命中返回 -1。
 */
export function binAt(layout: BinPackLayout, x: number, y: number): number {
  for (let b = 0; b < layout.bins.length; b += 1) {
    if (inside(layout.bins[b]!, x, y)) return b
  }
  return -1
}

/** 说明按钮是否被点中。 */
export function helpButtonHit(layout: BinPackLayout, x: number, y: number): boolean {
  return inside(layout.helpButton, x, y)
}

/** 画一个物品块：体积比例宽度 + 居中数字，选中发光。 */
function drawItemBlock(ctx: CanvasRenderingContext2D, rect: Rect, size: number, color: string, selected: boolean): void {
  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 6)
  ctx.fillStyle = selected ? color : shade(color)
  if (selected) glow(ctx, color, 12)
  ctx.fill()
  noGlow(ctx)
  ctx.strokeStyle = selected ? THEME.text : color
  ctx.lineWidth = selected ? 2 : 1
  ctx.stroke()
  ctx.fillStyle = selected ? '#15151b' : THEME.text
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(String(size), rect.x + rect.w / 2, rect.y + rect.h / 2 + 4)
}

/** 颜色加一层深色底（未选中物品块）。 */
function shade(color: string): string {
  return color + '33'
}

/** 渲染选项：阶段标志、悬停箱、帮助面板、粒子。 */
export interface RenderOptions {
  paused: boolean
  won: boolean
  /** 胜利文案（won 时展示）。 */
  winText: string | null
  /** 鼠标悬停的箱下标（-1 无），用于溢出红显。 */
  hoveredBin: number
  /** 说明面板是否展开。 */
  helpOpen: boolean
}

/**
 * 整幅渲染：背景 → HUD → 待装区 → 箱区 → 底部提示 → 粒子 → 暂停 /
 * 过关 overlay → 说明按钮 → 帮助面板（最后两步永远最上层）。
 */
export function renderBinPack(
  ctx: CanvasRenderingContext2D,
  state: BinPackState,
  opts: RenderOptions,
  particles?: { tick(ctx: CanvasRenderingContext2D, dtMs: number): void },
  dtMs = 16,
): void {
  const layout = computeLayout(state)
  drawBackground(ctx, LOGICAL_W, LOGICAL_H)

  ctx.textBaseline = 'alphabetic'
  hudPair(ctx, 24, 26, '关卡', state.level.level + '/' + 5)
  hudPair(ctx, 190, 26, '步数', String(state.steps))
  const used = state.binOf.length > 0 ? usedCount(state) : 0
  const usedColor = used > state.level.optimal ? THEME.bad : THEME.good
  hudPair(ctx, LOGICAL_W - 24, 26, '已用/最优', used + '/' + state.level.optimal, 'right', usedColor)

  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('待装物品（体积 1-9，块宽与体积成比例）', 24, 52)

  for (let i = 0; i < state.level.items.length; i += 1) {
    if (state.binOf[i]! >= 0) continue
    drawItemBlock(ctx, layout.tray[i]!, state.level.items[i]!, accent(i), state.selected === i)
  }

  for (let b = 0; b < state.binCount; b += 1) {
    drawBin(ctx, state, layout, b, opts.hoveredBin === b)
  }

  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('点物品选中 → 点箱放入；点箱内选中物品取出重放 · R 重开 P 暂停 H 说明', LOGICAL_W / 2, 540)

  particles?.tick(ctx, dtMs)

  if (opts.paused) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '暂停', '按 P 继续装箱', THEME.gold)
  } else if (opts.won) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '过关', opts.winText ?? '装箱达成', THEME.good)
  }

  drawHelpButton(ctx, layout.helpButton, opts.helpOpen)
  if (opts.helpOpen) drawHelpPanel(ctx)
}

/** 已用箱数（渲染层轻量重算，避免与 logic 循环依赖）。 */
function usedCount(state: BinPackState): number {
  const used = new Set<number>()
  for (const b of state.binOf) if (b >= 0) used.add(b)
  return used.size
}

/** 画一个箱：边框、标题、余量条、内部物品块。 */
function drawBin(ctx: CanvasRenderingContext2D, state: BinPackState, layout: BinPackLayout, b: number, hovered: boolean): void {
  const box = layout.bins[b]!
  const load = binLoad(state, b)
  const capacity = state.level.capacity
  roundRectPath(ctx, box.x, box.y, box.w, box.h, 8)
  ctx.fillStyle = THEME.panel
  ctx.fill()
  ctx.strokeStyle = hovered ? THEME.text : THEME.panelEdge
  ctx.lineWidth = hovered ? 2 : 1
  ctx.stroke()

  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('箱 ' + (b + 1), box.x + 10, box.y + 22)
  ctx.textAlign = 'right'
  ctx.fillStyle = load > capacity ? THEME.bad : THEME.text
  ctx.fillText(load + '/' + capacity, box.x + box.w - 10, box.y + 22)

  const barW = box.w - 20
  const barY = box.y + box.h - 24
  ctx.fillStyle = 'rgba(226,226,238,0.12)'
  ctx.fillRect(box.x + 10, barY, barW, 10)
  const fillW = Math.min(barW, Math.round((load / capacity) * barW))
  ctx.fillStyle = load >= capacity ? THEME.gold : THEME.good
  ctx.fillRect(box.x + 10, barY, fillW, 10)
  if (hovered && state.selected >= 0) {
    const size = state.level.items[state.selected]!
    const withSel = load + size
    if (withSel > capacity) {
      const start = Math.round((load / capacity) * barW)
      const overW = Math.min(barW, Math.round((withSel / capacity) * barW)) - start
      if (overW > 0) {
        ctx.fillStyle = THEME.bad
        ctx.fillRect(box.x + 10 + start, barY, overW, 10)
      }
      ctx.textAlign = 'left'
      ctx.fillStyle = THEME.bad
      ctx.fillText('超出 ' + (withSel - capacity), box.x + 10, box.y + box.h - 32)
    }
  }

  const rects = layout.binItems[b]!
  let n = -1
  for (let k = 0; k < state.level.items.length; k += 1) {
    if (state.binOf[k] !== b) continue
    n += 1
    const rect = rects[n]
    if (rect === undefined) break
    drawItemBlock(ctx, rect, state.level.items[k]!, accent(k), state.selected === k)
  }
}

/** 说明按钮（渲染末尾、最上层）。 */
function drawHelpButton(ctx: CanvasRenderingContext2D, rect: Rect, open: boolean): void {
  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 6)
  ctx.fillStyle = open ? accent(0) : THEME.panel
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = open ? '#15151b' : THEME.text
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(open ? '关闭' : '说明', rect.x + rect.w / 2, rect.y + 16)
}

const HELP_LINES = [
  '每关给你 8-16 件货物（体积 1-9）和容量固定的货柜。',
  '点击一件货物选中它，再点击目标货柜放进去。',
  '单个货柜内货物体积之和不得超过容量，违者放不进去。',
  '点击货柜内的货物选中，再点它一次即可取出重放。',
  '目标：把所有货物装完，且用柜数不超过「最优」。',
  '最优由生成器保证恰好可达成——先构造装箱再打乱给你。',
  '提示：先放大件、用小件填缝，贪心 FFD 往往就够用。',
  '放入与取出都计步；步数越少，过关得分越高。',
]

/** 帮助面板（渲染最末尾、盖在一切之上，任何阶段可开合）。 */
function drawHelpPanel(ctx: CanvasRenderingContext2D): void {
  const w = 680
  const h = 430
  const x = (LOGICAL_W - w) / 2
  const y = (LOGICAL_H - h) / 2
  roundRectPath(ctx, x, y, w, h, 10)
  ctx.fillStyle = 'rgba(20,20,30,0.96)'
  ctx.fill()
  ctx.strokeStyle = accent(0)
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.font = 'bold 20px system-ui, sans-serif'
  ctx.fillStyle = THEME.text
  ctx.fillText('装箱谜题 规则说明', LOGICAL_W / 2, y + 40)
  ctx.font = '500 15px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = THEME.text
  for (let i = 0; i < HELP_LINES.length; i += 1) {
    ctx.fillText(HELP_LINES[i]!, x + 28, y + 82 + i * 26)
  }
  ctx.textAlign = 'center'
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('点右下角「说明」或按 H 关闭 · 暂停时也能看', LOGICAL_W / 2, y + h - 18)
}
