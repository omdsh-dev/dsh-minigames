/**
 * 花径寻踪渲染：春日花园风画面——草地双色格、五瓣花朵、岩石、提示数字
 * 大字（不符红显、超额/不足标当前数）、花邻突红圈、悬停与提示高亮。纯
 * 绘制 + 布局导出（index.ts 用同一份布局做点击命中，杜绝绘制与命中错
 * 位）。说明按钮与帮助面板画在整个渲染函数的最末尾，保证盖在棋盘与
 * overlay 之上；任何阶段都可开合。
 */
import { THEME, accent, glow, noGlow, roundRectPath, drawBackground, drawOverlay, hudPair } from '../theme.ts'
import { CELL_CLUE, CELL_EMPTY, CELL_ROCK, MARK_FLOWER, type GardenPathPuzzle } from './logic.ts'

/** 逻辑画布尺寸（关卡间不变，自适应交给 fitCanvas 变换）。 */
export const LOGICAL_W = 960
export const LOGICAL_H = 580

/** 一个矩形（逻辑坐标）。 */
export interface Rect { x: number, y: number, w: number, h: number }

/** 布局：棋盘矩形、格边长、说明按钮。 */
export interface GardenLayout {
  /** 棋盘整体矩形（含四周留白已扣除）。 */
  board: Rect
  /** 单格边长。 */
  cell: number
  /** 说明按钮（60x24，右下角）。 */
  helpButton: Rect
}

const BOARD_TOP = 64
const BOARD_BOTTOM = 540
const BOARD_SIDE = 32

/** 春日花园调色板（草地/花瓣/花芯/岩石）。 */
const GRASS_A = 'rgba(126,196,84,0.20)'
const GRASS_B = 'rgba(126,196,84,0.12)'
const GRASS_BLADE = 'rgba(126,196,84,0.55)'
const PETAL = '#f2a4d0'
const PETAL_EDGE = 'rgba(21,21,27,0.45)'
const FLOWER_CORE = '#e0af68'
const ROCK_FILL = '#3a3a50'
const ROCK_EDGE = '#5a5a76'

/**
 * 计算整幅布局（绘制与命中共用）：格边长按盘面边长自适应，棋盘居中。
 * @param puzzle - 盘面。
 * @returns 完整布局矩形。
 */
export function computeLayout(puzzle: GardenPathPuzzle): GardenLayout {
  const size = puzzle.size
  const cell = Math.min(
    Math.floor((LOGICAL_W - BOARD_SIDE * 2) / size),
    Math.floor((BOARD_BOTTOM - BOARD_TOP) / size),
  )
  const boardW = cell * size
  const boardH = cell * size
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
 * @param puzzle - 盘面。
 * @param x - 逻辑横坐标。
 * @param y - 逻辑纵坐标。
 * @returns 格下标，未命中返回 -1。
 */
export function cellAt(layout: GardenLayout, puzzle: GardenPathPuzzle, x: number, y: number): number {
  const b = layout.board
  if (x < b.x || y < b.y || x >= b.x + b.w || y >= b.y + b.h) return -1
  const col = Math.floor((x - b.x) / layout.cell)
  const row = Math.floor((y - b.y) / layout.cell)
  return row * puzzle.size + col
}

/**
 * 某格中心点（粒子/高亮定位用）。
 * @param layout - 布局。
 * @param puzzle - 盘面。
 * @param cell - 格下标。
 */
export function cellCenter(layout: GardenLayout, puzzle: GardenPathPuzzle, cell: number): { x: number, y: number } {
  const size = puzzle.size
  const r = Math.floor(cell / size)
  const c = cell % size
  return {
    x: layout.board.x + (c + 0.5) * layout.cell,
    y: layout.board.y + (r + 0.5) * layout.cell,
  }
}

/** 说明按钮是否被点中。 */
export function helpButtonHit(layout: GardenLayout, x: number, y: number): boolean {
  const h = layout.helpButton
  return x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h
}

/** 渲染选项：悬停/提示格、错误反馈集合、阶段标志、帮助面板。 */
export interface RenderOptions {
  /** 悬停的空地下标（-1 无）。 */
  hovered: number
  /** 提示点亮格（-1 无，短暂显示金色高亮）。 */
  hintCell: number
  /** 与数字不符的提示格列表（红显）。 */
  badClues: number[]
  /** 八向相邻的花格列表（红圈）。 */
  conflicts: number[]
  /** 关卡显示号（1 基）。 */
  level: number
  /** 步数（点击切换次数）。 */
  steps: number
  /** 已满足的提示数。 */
  cluesSat: number
  /** 提示总数。 */
  cluesTotal: number
  /** 暂停中。 */
  paused: boolean
  /** 已过关。 */
  won: boolean
  /** 过关文案。 */
  winText: string | null
  /** 说明面板是否展开。 */
  helpOpen: boolean
}

/**
 * 整幅渲染：背景 → HUD → 棋盘（草地/岩石/提示/花/反馈/悬停）→ 底部
 * 提示条 → 粒子 → 暂停/过关 overlay → 说明按钮 → 帮助面板（最后两步
 * 永远最上层）。
 * @param ctx - 画布上下文（fitCanvas 变换后的逻辑坐标）。
 * @param puzzle - 盘面。
 * @param marks - 玩家标记。
 * @param opts - 渲染选项。
 * @param particles - 可选粒子系统（过关时 index.ts 注入）。
 * @param dtMs - 粒子推进毫秒。
 */
export function renderGardenPath(
  ctx: CanvasRenderingContext2D,
  puzzle: GardenPathPuzzle,
  marks: Uint8Array,
  opts: RenderOptions,
  particles?: { tick(ctx: CanvasRenderingContext2D, dtMs: number): void },
  dtMs = 16,
): void {
  const layout = computeLayout(puzzle)
  drawBackground(ctx, LOGICAL_W, LOGICAL_H)
  ctx.textBaseline = 'alphabetic'

  // HUD 左组：关卡、步数；右组：线索满足、剩余提示（右锚定宽，列距充足）。
  hudPair(ctx, 24, 26, '关卡', opts.level + '/' + 5)
  hudPair(ctx, 170, 26, '步数', String(opts.steps))
  hudPair(ctx, LOGICAL_W - 24, 26, '线索', opts.cluesSat + '/' + opts.cluesTotal, 'right',
    opts.cluesSat === opts.cluesTotal ? THEME.good : THEME.text)
  const cover = coverProgress(puzzle, marks)
  hudPair(ctx, LOGICAL_W - 220, 26, '覆盖', cover + '/' + coverTotal(puzzle), 'right',
    cover === coverTotal(puzzle) ? THEME.good : THEME.text)

  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('数字 = 四邻花数 · 花互不相邻（斜也算）· 每块草都要挨着花', 24, 52)

  drawBoard(ctx, puzzle, marks, layout, opts)

  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('点空地在花/草间切换 · H 提示 · R 重开 · P 暂停 · [ ] 切关', LOGICAL_W / 2, 562)

  particles?.tick(ctx, dtMs)

  if (opts.paused) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '暂停', '按 P 回到花园', THEME.gold)
  } else if (opts.won) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '过关', opts.winText ?? '花径已成', THEME.good)
  }

  drawHelpButton(ctx, layout.helpButton, opts.helpOpen)
  if (opts.helpOpen) drawHelpPanel(ctx)
}

/** 画整个棋盘：底框 + 逐格草地/岩石/提示/花，再叠反馈与高亮。 */
function drawBoard(
  ctx: CanvasRenderingContext2D,
  puzzle: GardenPathPuzzle,
  marks: Uint8Array,
  layout: GardenLayout,
  opts: RenderOptions,
): void {
  const b = layout.board
  roundRectPath(ctx, b.x - 6, b.y - 6, b.w + 12, b.h + 12, 10)
  ctx.fillStyle = THEME.panel
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()

  const size = puzzle.size
  const cell = layout.cell
  const badSet = new Set(opts.badClues)
  const conflictSet = new Set(opts.conflicts)
  for (let i = 0; i < size * size; i += 1) {
    const x = b.x + (i % size) * cell
    const y = b.y + Math.floor(i / size) * cell
    const kind = puzzle.cells[i]
    if (kind === CELL_ROCK) {
      drawRock(ctx, x, y, cell)
      continue
    }
    if (kind === CELL_CLUE) {
      drawClue(ctx, x, y, cell, puzzle.clueNumbers[i]!, clueCurrent(puzzle, marks, i), badSet.has(i))
      continue
    }
    // 空地：草地双色棋盘格。
    ctx.fillStyle = ((Math.floor(i / size) + (i % size)) % 2 === 0) ? GRASS_A : GRASS_B
    ctx.fillRect(x, y, cell, cell)
    drawGrassBlades(ctx, x, y, cell)
    if (marks[i] === MARK_FLOWER) drawFlower(ctx, x, y, cell, conflictSet.has(i))
  }

  // 悬停高亮（仅可种的空地）。
  if (opts.hovered >= 0 && puzzle.cells[opts.hovered] === CELL_EMPTY) {
    const x = b.x + (opts.hovered % size) * cell
    const y = b.y + Math.floor(opts.hovered / size) * cell
    ctx.strokeStyle = accent(0)
    ctx.lineWidth = 2
    ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2)
  }

  // 提示点亮高亮（金色）。注：marks 已含提示落子，这里画的是格子框。
  if (opts.hintCell >= 0) {
    const x = b.x + (opts.hintCell % size) * cell
    const y = b.y + Math.floor(opts.hintCell / size) * cell
    glow(ctx, THEME.gold, 10)
    ctx.strokeStyle = THEME.gold
    ctx.lineWidth = 3
    ctx.strokeRect(x + 2, y + 2, cell - 4, cell - 4)
    noGlow(ctx)
  }
}

/** 草叶纹理：三根短竖线，柔和低调。 */
function drawGrassBlades(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number): void {
  ctx.strokeStyle = GRASS_BLADE
  ctx.lineWidth = 1
  const cx = x + cell / 2
  const base = y + cell * 0.72
  ctx.beginPath()
  ctx.moveTo(cx - cell * 0.16, base)
  ctx.lineTo(cx - cell * 0.16, base - cell * 0.18)
  ctx.moveTo(cx, base + cell * 0.04)
  ctx.lineTo(cx, base - cell * 0.16)
  ctx.moveTo(cx + cell * 0.16, base)
  ctx.lineTo(cx + cell * 0.16, base - cell * 0.18)
  ctx.stroke()
}

/** 岩石格：圆角灰石 + 两道高光。 */
function drawRock(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number): void {
  const inset = cell * 0.12
  roundRectPath(ctx, x + inset, y + inset, cell - inset * 2, cell - inset * 2, Math.max(3, cell * 0.14))
  ctx.fillStyle = ROCK_FILL
  ctx.fill()
  ctx.strokeStyle = ROCK_EDGE
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.strokeStyle = 'rgba(226,226,238,0.25)'
  ctx.beginPath()
  ctx.moveTo(x + cell * 0.3, y + cell * 0.42)
  ctx.lineTo(x + cell * 0.45, y + cell * 0.34)
  ctx.moveTo(x + cell * 0.38, y + cell * 0.58)
  ctx.lineTo(x + cell * 0.52, y + cell * 0.5)
  ctx.stroke()
}

/** 空地总数（覆盖进度分母；渲染层轻量重算，避免与 logic 循环依赖）。 */
function coverTotal(puzzle: GardenPathPuzzle): number {
  let total = 0
  for (const kind of puzzle.cells) {
    if (kind === CELL_EMPTY) total += 1
  }
  return total
}

/** 已覆盖（是花或八向邻花）的空地数。 */
function coverProgress(puzzle: GardenPathPuzzle, marks: Uint8Array): number {
  const size = puzzle.size
  let covered = 0
  for (let i = 0; i < puzzle.cells.length; i += 1) {
    if (puzzle.cells[i] !== CELL_EMPTY) continue
    if (marks[i] === MARK_FLOWER) { covered += 1; continue }
    const r = Math.floor(i / size)
    const c = i % size
    let hit = false
    for (let dr = -1; dr <= 1 && !hit; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dr === 0 && dc === 0) continue
        const nr = r + dr
        const nc = c + dc
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue
        if (marks[nr * size + nc] === MARK_FLOWER) { hit = true; break }
      }
    }
    if (hit) covered += 1
  }
  return covered
}

/** 某提示格四邻的当前花数（渲染层轻量重算，避免与 logic 循环依赖）。 */
function clueCurrent(puzzle: GardenPathPuzzle, marks: Uint8Array, cell: number): number {
  const size = puzzle.size
  const r = Math.floor(cell / size)
  const c = cell % size
  let count = 0
  if (r > 0 && marks[cell - size] === 1) count += 1
  if (r < size - 1 && marks[cell + size] === 1) count += 1
  if (c > 0 && marks[cell - 1] === 1) count += 1
  if (c < size - 1 && marks[cell + 1] === 1) count += 1
  return count
}

/**
 * 提示格：面板底色 + 大号数字。颜色语义：不满足红、满足绿。
 * 不符时数字下方补一行 11px 当前数，帮助定位差距。
 */
function drawClue(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number, number: number, current: number, bad: boolean): void {
  roundRectPath(ctx, x + 2, y + 2, cell - 4, cell - 4, 5)
  ctx.fillStyle = 'rgba(30,30,42,0.92)'
  ctx.fill()
  ctx.strokeStyle = bad ? THEME.bad : THEME.panelEdge
  ctx.lineWidth = bad ? 2 : 1
  ctx.stroke()
  const font = 'bold ' + Math.min(26, Math.floor(cell * 0.5)) + 'px system-ui, sans-serif'
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.fillStyle = bad ? THEME.bad : THEME.good
  ctx.fillText(String(number), x + cell / 2, y + cell / 2 + Math.min(26, Math.floor(cell * 0.5)) * 0.35)
  if (bad) {
    ctx.font = '600 11px system-ui, sans-serif'
    ctx.fillStyle = THEME.bad
    ctx.fillText('当前 ' + current, x + cell / 2, y + cell - 6)
  }
}

/** 五瓣花：花瓣圆 + 金芯，冲突时加红圈。 */
function drawFlower(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number, conflict: boolean): void {
  const cx = x + cell / 2
  const cy = y + cell / 2
  const r = cell * 0.26
  glow(ctx, PETAL, 8)
  ctx.fillStyle = PETAL
  for (let p = 0; p < 5; p += 1) {
    const angle = (p / 5) * Math.PI * 2 - Math.PI / 2
    ctx.beginPath()
    ctx.arc(cx + Math.cos(angle) * r * 0.62, cy + Math.sin(angle) * r * 0.62, r * 0.46, 0, Math.PI * 2)
    ctx.fill()
  }
  noGlow(ctx)
  ctx.strokeStyle = PETAL_EDGE
  ctx.lineWidth = 1
  for (let p = 0; p < 5; p += 1) {
    const angle = (p / 5) * Math.PI * 2 - Math.PI / 2
    ctx.beginPath()
    ctx.arc(cx + Math.cos(angle) * r * 0.62, cy + Math.sin(angle) * r * 0.62, r * 0.46, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.fillStyle = FLOWER_CORE
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.32, 0, Math.PI * 2)
  ctx.fill()
  if (conflict) {
    ctx.strokeStyle = THEME.bad
    ctx.lineWidth = 2
    ctx.strokeRect(x + 2, y + 2, cell - 4, cell - 4)
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
  '目标：把每块空地都定成花或草，让全部约束同时成立（每关唯一解）。',
  '数字 N：该格上下左右四邻中恰有 N 朵花——对角方向的花不计入。',
  '花与花不能相邻：横、竖、斜八个方向都不行。',
  '花径覆盖：留草的空地必须紧挨（八向）至少一朵花，路径要铺满全园。',
  '岩石格与数字格不能种花，其余空地都可种。',
  '点击空地在花与草之间切换；H 最多 2 次提示（点亮一格正解）。',
  '常见误读：数字数的是四邻的花，不含格子自身；草可以挨着草。',
  '红字提示 = 邻花数不符（下方小字为当前数）；红圈花 = 与别的花相邻。',
]

/** 帮助面板（渲染最末尾、盖在一切之上，任何阶段可开合）。 */
function drawHelpPanel(ctx: CanvasRenderingContext2D): void {
  const w = 700
  const h = 420
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
  ctx.fillText('花径寻踪 规则说明', LOGICAL_W / 2, y + 40)
  ctx.font = '500 15px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = THEME.text
  for (let i = 0; i < HELP_LINES.length; i += 1) {
    ctx.fillText(HELP_LINES[i]!, x + 28, y + 84 + i * 30)
  }
  ctx.textAlign = 'center'
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('点右下角「说明」关闭 · 暂停/过关时也能看', LOGICAL_W / 2, y + h - 18)
}
