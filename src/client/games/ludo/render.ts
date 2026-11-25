/**
 * 飞行棋 Ludo 渲染层：经典四色十字盘（机场四角、跑道格着色、安全格
 * 星标、终点箭头）、开局人数选择 overlay（2/3/4 人）、右侧骰子与人数
 * HUD、飞机形棋子与叠子计数、悬停落点预览高亮、踩子回程幽灵动画、
 * 说明按钮与帮助面板（画在整个渲染函数末尾、永远最上层）、暂停与胜
 * 负 overlay。所有布局常量集中声明，供命中检测与遮挡核算共用，杜绝
 * 绘制与命中错位。
 */
import { THEME, accent, drawBackground, drawOverlay, glow, hudPair, noGlow, roundRectPath } from '../theme.ts'
import { GOAL_POS, RING_LAST, START_INDEX, type LudoState, type Side } from './logic.ts'

/** 逻辑画布尺寸。 */
export const LOGICAL_W = 700
export const LOGICAL_H = 560
/** 盘面：15x15 网格，格边 34px，左上角 (12,25)。 */
export const CELL = 34
export const BOARD_X = 12
export const BOARD_Y = 25
const BOARD_END_X = BOARD_X + 15 * CELL
const BOARD_END_Y = BOARD_Y + 15 * CELL
/** 右侧 HUD 面板。 */
const PANEL_X = 540
const PANEL_W = 148
const PANEL_END_X = PANEL_X + PANEL_W
/** 骰子框与掷骰按钮。 */
const DICE_RECT = { x: 582, y: 150, w: 64, h: 64 }
const ROLL_RECT = { x: 554, y: 228, w: 120, h: 32 }
/** 说明按钮（60x24，右下角）。 */
const HELP_RECT = { x: 630, y: 530, w: 60, h: 24 }
/** 底部操作提示。 */
const HINT_Y = 551

/** 四色（红=玩家 you、黄=ai、蓝=blue、绿=green）。 */
const RED = accent(4)
const YEL = accent(3)
const GREEN = THEME.good
const BLUE = accent(0)
const SIDE_COLOR: Record<Side, string> = { you: RED, ai: YEL, blue: BLUE, green: GREEN }
const SIDE_DIM: Record<Side, string> = {
  you: 'rgba(247,118,142,0.28)',
  ai: 'rgba(224,175,104,0.28)',
  blue: 'rgba(122,162,247,0.28)',
  green: 'rgba(126,211,141,0.28)',
}
const sideColor = (side: Side): string => SIDE_COLOR[side]
const sideDim = (side: Side): string => SIDE_DIM[side]

/** 环形跑道 52 格的网格坐标 [col,row]（顺时针，下标即环上下标）。 */
export const RING_PATH: ReadonlyArray<readonly [number, number]> = [
  [0, 6], [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
  [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],
  [7, 0], [8, 0],
  [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
  [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6],
  [14, 7], [14, 8],
  [13, 8], [12, 8], [11, 8], [10, 8], [9, 8],
  [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14],
  [7, 14], [6, 14],
  [6, 13], [6, 12], [6, 11], [6, 10], [6, 9],
  [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  [0, 7],
]

/** 终点直线 51-55 步的网格坐标（56 步为中心终点；含全部四色）。 */
const HOME_PATH: Record<Side, ReadonlyArray<readonly [number, number]>> = {
  you: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
  ai: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  blue: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
  green: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
}

/** 机场四角停机位的网格坐标（红左下、黄左上、绿右上、蓝右下）。 */
const AIRPORT: Record<Side, ReadonlyArray<readonly [number, number]>> = {
  you: [[1, 10], [4, 10], [1, 13], [4, 13]],
  ai: [[1, 1], [4, 1], [1, 4], [4, 4]],
  green: [[10, 1], [13, 1], [10, 4], [13, 4]],
  blue: [[10, 10], [13, 10], [10, 13], [13, 13]],
}

/** 各色起飞格下标（渲染着色用）。 */
const COLOR_START: ReadonlyArray<{ idx: number, color: string }> = [
  { idx: 40, color: RED },
  { idx: 1, color: YEL },
  { idx: 14, color: BLUE },
  { idx: 27, color: GREEN },
]
/** 星标安全格（每色起飞格 + 8 步处）。 */
const STAR_CELLS = [9, 22, 35, 48]

/** 网格中心像素坐标。 */
function cellCenter(col: number, row: number): { x: number, y: number } {
  return { x: BOARD_X + col * CELL + CELL / 2, y: BOARD_Y + row * CELL + CELL / 2 }
}

/**
 * 棋子（编号 piece）在其当前位置编码下的像素中心。
 * @param side - 哪一方。
 * @param pos - 位置编码（-1 机场 / 0-50 跑道 / 51-56 终点直线）。
 * @param piece - 飞机编号（机场停机位用）。
 * @returns 像素中心坐标。
 */
export function posToCenter(side: Side, pos: number, piece: number): { x: number, y: number } {
  if (pos === -1) {
    const slot = AIRPORT[side][piece] ?? [2, 2]
    return cellCenter(slot[0]!, slot[1]!)
  }
  if (pos <= RING_LAST) {
    const idx = (START_INDEX[side] + pos) % 52
    const cell = RING_PATH[idx] ?? RING_PATH[0]!
    return cellCenter(cell[0], cell[1])
  }
  if (pos < GOAL_POS) {
    const cell = HOME_PATH[side][pos - 51] ?? HOME_PATH[side][0]!
    return cellCenter(cell[0], cell[1])
  }
  return cellCenter(7, 7)
}

/** 渲染视图：index 每帧组装的纯快照。 */
export interface LudoView {
  state: LudoState
  /** 玩家当前可动的飞机编号（高亮 + 命中）。 */
  movable: number[]
  /** 开局人数选择中（未选 2/3/4 前不进入对局）。 */
  setup: boolean
  /** 悬停预览：待行子阶段鼠标悬停的可动飞机编号（无则 null）。 */
  hoverPiece: number | null
  /** 悬停飞机的预览落点位置编码（hoverPiece 非空时有效）。 */
  hoverTo: number | null
  /** 骰子滚动中。 */
  rolling: boolean
  /** 滚动动画当前显示面。 */
  rollingFace: number
  /** 最近捕获（跑道绝对下标 + 触发时刻 + 受害方），驱动回程幽灵动画。 */
  capture: { cells: number[], at: number, victim: Side } | null
  userPaused: boolean
  paused: boolean
  helpOpen: boolean
  now: number
}

/** 掷骰按钮是否被点中。 */
export function rollButtonAt(x: number, y: number): boolean {
  return x >= ROLL_RECT.x && x <= ROLL_RECT.x + ROLL_RECT.w && y >= ROLL_RECT.y && y <= ROLL_RECT.y + ROLL_RECT.h
}

/** 说明按钮是否被点中。 */
export function helpButtonAt(x: number, y: number): boolean {
  return x >= HELP_RECT.x && x <= HELP_RECT.x + HELP_RECT.w && y >= HELP_RECT.y && y <= HELP_RECT.y + HELP_RECT.h
}

/** 开局人数按钮（2/3/4 人，垂直排列于盘面中央）。 */
const SETUP_BUTTONS: ReadonlyArray<{ count: number, x: number, y: number, w: number, h: number }> = [
  { count: 2, x: 240, y: 200, w: 220, h: 44 },
  { count: 3, x: 240, y: 256, w: 220, h: 44 },
  { count: 4, x: 240, y: 312, w: 220, h: 44 },
]

/**
 * 开局人数按钮命中检测。
 * @param x - 逻辑横坐标。
 * @param y - 逻辑纵坐标。
 * @returns 命中的人数（2/3/4），未命中返回 null。
 */
export function setupButtonAt(x: number, y: number): number | null {
  for (const b of SETUP_BUTTONS) {
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.count
  }
  return null
}

/**
 * 命中检测：玩家可动飞机中距 (x,y) 最近且在 20px 内的编号。
 * @param state - 当前比赛状态。
 * @param movable - 可动飞机编号列表。
 * @param x - 逻辑横坐标。
 * @param y - 逻辑纵坐标。
 * @returns 命中的飞机编号，未命中返回 null。
 */
export function planeAt(state: LudoState, movable: number[], x: number, y: number): number | null {
  let best: number | null = null
  let bestDist = 20
  for (const piece of movable) {
    const c = posToCenter('you', state.pieces.you[piece] ?? -1, piece)
    const d = Math.hypot(x - c.x, y - c.y)
    if (d <= bestDist) {
      bestDist = d
      best = piece
    }
  }
  return best
}

/** 画一个飞机形棋子（朝上的纸飞机剪影 + 底座圆）。 */
function drawPlane(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, scale = 1): void {
  const s = 11 * scale
  ctx.beginPath()
  ctx.arc(x, y, s + 3, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(16,16,26,0.85)'
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x, y - s)
  ctx.lineTo(x + s * 0.82, y + s * 0.72)
  ctx.lineTo(x, y + s * 0.3)
  ctx.lineTo(x - s * 0.82, y + s * 0.72)
  ctx.closePath()
  glow(ctx, color, 5)
  ctx.fillStyle = color
  ctx.fill()
  noGlow(ctx)
}

/** 画星标（安全格）。 */
function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.beginPath()
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? 7 : 3
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const px = x + Math.cos(a) * r
    const py = y + Math.sin(a) * r
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fillStyle = color
  ctx.globalAlpha = 0.85
  ctx.fill()
  ctx.globalAlpha = 1
}

/** 画骰子（pip 标准布局；六点时发光提示再掷）。 */
function drawDice(ctx: CanvasRenderingContext2D, face: number, cx: number, cy: number, hot: boolean): void {
  const x = cx - 28
  const y = cy - 28
  roundRectPath(ctx, x, y, 56, 56, 10)
  ctx.fillStyle = '#e8e8f2'
  if (hot) glow(ctx, THEME.gold, 14)
  ctx.fill()
  noGlow(ctx)
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  const pips: Record<number, ReadonlyArray<readonly [number, number]>> = {
    1: [[0, 0]],
    2: [[-1, -1], [1, 1]],
    3: [[-1, -1], [0, 0], [1, 1]],
    4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
    5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
    6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
  }
  ctx.fillStyle = '#15151b'
  for (const [dx, dy] of pips[face] ?? pips[1]!) {
    ctx.beginPath()
    ctx.arc(cx + dx * 14, cy + dy * 14, 5, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** 画盘面：底板、机场角块、跑道格、着色起飞格、星标、终点直线与中心。参战色亮显，未参战色暗化装饰。 */
function drawBoard(ctx: CanvasRenderingContext2D, active: readonly Side[]): void {
  roundRectPath(ctx, BOARD_X, BOARD_Y, 15 * CELL, 15 * CELL, 8)
  ctx.fillStyle = THEME.panel
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  // 机场四角：红左下、黄左上、绿右上、蓝右下；未参战色暗化。
  const corners: ReadonlyArray<{ col: number, row: number, color: string, alpha: number }> = [
    { col: 0, row: 9, color: RED, alpha: active.includes('you') ? 0.2 : 0.1 },
    { col: 0, row: 0, color: YEL, alpha: active.includes('ai') ? 0.2 : 0.1 },
    { col: 9, row: 0, color: GREEN, alpha: active.includes('green') ? 0.2 : 0.1 },
    { col: 9, row: 9, color: BLUE, alpha: active.includes('blue') ? 0.2 : 0.1 },
  ]
  for (const c of corners) {
    roundRectPath(ctx, BOARD_X + c.col * CELL + 3, BOARD_Y + c.row * CELL + 3, 6 * CELL - 6, 6 * CELL - 6, 8)
    ctx.globalAlpha = c.alpha
    ctx.fillStyle = c.color
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = c.color
    ctx.stroke()
  }
  // 参战色机场停机位圆环。
  for (const side of active) {
    for (const [col, row] of AIRPORT[side]) {
      const c = cellCenter(col, row)
      ctx.beginPath()
      ctx.arc(c.x, c.y, 12, 0, Math.PI * 2)
      ctx.strokeStyle = sideDim(side)
      ctx.lineWidth = 2
      ctx.stroke()
    }
  }
  // 跑道格。
  for (let i = 0; i < RING_PATH.length; i += 1) {
    const [col, row] = RING_PATH[i]!
    const x = BOARD_X + col * CELL
    const y = BOARD_Y + row * CELL
    const start = COLOR_START.find(cs => cs.idx === i)
    ctx.fillStyle = start === undefined ? 'rgba(30,30,42,0.9)' : start.color
    if (start !== undefined) ctx.globalAlpha = 0.55
    ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2)
    ctx.globalAlpha = 1
    ctx.strokeStyle = 'rgba(52,52,74,0.9)'
    ctx.lineWidth = 1
    ctx.strokeRect(x + 1, y + 1, CELL - 2, CELL - 2)
    if (STAR_CELLS.includes(i)) {
      const c = cellCenter(col, row)
      const starColor = i === 48 ? RED : i === 9 ? YEL : i === 22 ? BLUE : GREEN
      drawStar(ctx, c.x, c.y, starColor)
    }
  }
  // 终点直线（越靠近中心颜色越浓）+ 指向中心的箭头：参战色全亮。
  for (const side of active) {
    const color = sideColor(side)
    for (let k = 0; k < HOME_PATH[side].length; k += 1) {
      const [col, row] = HOME_PATH[side][k]!
      ctx.globalAlpha = 0.3 + (k / HOME_PATH[side].length) * 0.35
      ctx.fillStyle = color
      ctx.fillRect(BOARD_X + col * CELL + 1, BOARD_Y + row * CELL + 1, CELL - 2, CELL - 2)
      ctx.globalAlpha = 1
    }
    const [ec, er] = HOME_PATH[side][0]!
    const from = cellCenter(ec, er)
    const to = cellCenter(7, 7)
    const mx = (from.x + to.x) / 2
    const my = (from.y + to.y) / 2
    const ang = Math.atan2(to.y - from.y, to.x - from.x)
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(mx, my)
    ctx.strokeStyle = color
    ctx.lineWidth = 3
    ctx.globalAlpha = 0.7
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.beginPath()
    ctx.moveTo(to.x - Math.cos(ang) * 4, to.y - Math.sin(ang) * 4)
    ctx.lineTo(mx + Math.cos(ang + 2.5) * 9, my + Math.sin(ang + 2.5) * 9)
    ctx.lineTo(mx + Math.cos(ang - 2.5) * 9, my + Math.sin(ang - 2.5) * 9)
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
  }
  // 未参战色的终点直线（装饰、暗化）。
  for (const side of (['you', 'ai', 'blue', 'green'] as const) as Side[]) {
    if (active.includes(side)) continue
    for (const [col, row] of HOME_PATH[side]) {
      ctx.globalAlpha = 0.18
      ctx.fillStyle = sideColor(side)
      ctx.fillRect(BOARD_X + col * CELL + 1, BOARD_Y + row * CELL + 1, CELL - 2, CELL - 2)
      ctx.globalAlpha = 1
    }
  }
  // 中心终点：深色圆盘 + 四色三角指向各自终点直线。
  const center = cellCenter(7, 7)
  const r = CELL * 1.4
  ctx.beginPath()
  ctx.arc(center.x, center.y, r, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(13,13,20,0.92)'
  ctx.fill()
  ctx.strokeStyle = THEME.gold
  ctx.lineWidth = 1.5
  ctx.stroke()
  const tris: ReadonlyArray<{ color: string, ang: number }> = [
    { color: RED, ang: Math.PI / 2 },
    { color: YEL, ang: 0 },
    { color: GREEN, ang: -Math.PI / 2 },
    { color: BLUE, ang: Math.PI },
  ]
  for (const t of tris) {
    ctx.beginPath()
    ctx.moveTo(center.x + Math.cos(t.ang) * (r - 2), center.y + Math.sin(t.ang) * (r - 2))
    ctx.lineTo(center.x + Math.cos(t.ang + 2.3) * (r - 2), center.y + Math.sin(t.ang + 2.3) * (r - 2))
    ctx.lineTo(center.x, center.y)
    ctx.closePath()
    ctx.globalAlpha = 0.4
    ctx.fillStyle = t.color
    ctx.fill()
    ctx.globalAlpha = 1
  }
}

/** 画全部棋子：按位置聚合，同格叠子画 ×n 徽标；终点棋子向中心收拢。 */
function drawPieces(ctx: CanvasRenderingContext2D, state: LudoState, movable: number[], now: number): void {
  for (const side of state.sides) {
    const groups = new Map<number, number[]>()
    for (let i = 0; i < state.pieces[side].length; i += 1) {
      const pos = state.pieces[side][i]!
      const list = groups.get(pos) ?? []
      list.push(i)
      groups.set(pos, list)
    }
    for (const [pos, list] of groups) {
      const first = list[0]!
      const c = posToCenter(side, pos, first)
      let x = c.x
      let y = c.y
      let scale = 1
      if (pos === GOAL_POS) {
        // 终点棋子沿各自来向小幅排开，避免盖住中心图案。
        const off = (list.length - 1) * 3
        if (side === 'you') { x -= off; y += off }
        else if (side === 'ai') { x += off; y -= off }
        else if (side === 'blue') { x -= off; y -= off }
        else { x += off; y += off }
        scale = 0.7
      } else if (pos !== -1 && list.length > 1) {
        x -= (list.length - 1) * 4
      }
      drawPlane(ctx, x, y, sideColor(side), scale)
      if (pos !== -1 && pos !== GOAL_POS && list.length > 1) {
        ctx.font = '700 11px system-ui, sans-serif'
        ctx.textAlign = 'left'
        ctx.fillStyle = THEME.text
        ctx.fillText('×' + list.length, x + 9, y - 9)
      }
      if (side === 'you' && pos !== GOAL_POS && movable.includes(list[0]!)) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 240)
        ctx.beginPath()
        ctx.arc(x, y, 16 + pulse * 2, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(226,226,238,' + (0.4 + pulse * 0.4).toFixed(2) + ')'
        ctx.lineWidth = 2
        ctx.stroke()
      }
    }
  }
}

/** 悬停预览：被悬停飞机加亮圈、其落点格画呼吸光斑（含终点与反弹位）。 */
function drawHoverPreview(ctx: CanvasRenderingContext2D, view: LudoView): void {
  if (view.hoverPiece === null || view.hoverTo === null) return
  const pulse = 0.5 + 0.5 * Math.sin(view.now / 200)
  const from = posToCenter('you', view.state.pieces.you[view.hoverPiece] ?? -1, view.hoverPiece)
  ctx.beginPath()
  ctx.arc(from.x, from.y, 13, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(255,236,170,' + (0.5 + pulse * 0.4).toFixed(2) + ')'
  ctx.lineWidth = 2.5
  ctx.stroke()
  const target = posToCenter('you', view.hoverTo, view.hoverPiece)
  const isGoal = view.hoverTo === GOAL_POS
  ctx.beginPath()
  ctx.arc(target.x, target.y, 14 + pulse * 3, 0, Math.PI * 2)
  ctx.strokeStyle = isGoal ? 'rgba(255,215,120,' + (0.55 + pulse * 0.4).toFixed(2) + ')' : 'rgba(122,162,247,' + (0.5 + pulse * 0.45).toFixed(2) + ')'
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(target.x, target.y)
  ctx.setLineDash([4, 6])
  ctx.strokeStyle = 'rgba(226,226,238,' + (0.28 + pulse * 0.2).toFixed(2) + ')'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.setLineDash([])
}

/** 踩子回程幽灵动画：450ms 内被捕获敌机从被踩格飞回其机场并淡出。 */
function drawCaptureGhost(ctx: CanvasRenderingContext2D, view: LudoView): void {
  if (view.capture === null) return
  const t = (view.now - view.capture.at) / 450
  if (t < 0 || t > 1) return
  const base = AIRPORT[view.capture.victim][0]!
  const home = cellCenter(base[0], base[1])
  for (const idx of view.capture.cells) {
    const cell = RING_PATH[idx] ?? RING_PATH[0]!
    const from = cellCenter(cell[0], cell[1])
    const x = from.x + (home.x - from.x) * t
    const y = from.y + (home.y - from.y) * t - Math.sin(t * Math.PI) * 30
    ctx.globalAlpha = 1 - t * 0.7
    drawPlane(ctx, x, y, sideColor(view.capture.victim), 0.8)
    ctx.globalAlpha = 1
  }
}

/** 右侧 HUD：标题、人数/局数/局分、回合指示、骰子、按钮、到终计数、消息。 */
function drawHud(ctx: CanvasRenderingContext2D, view: LudoView): void {
  const state = view.state
  roundRectPath(ctx, PANEL_X - 8, 36, PANEL_W + 16, 428, 8)
  ctx.fillStyle = 'rgba(20,20,30,0.6)'
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.font = 'bold 20px system-ui, sans-serif'
  ctx.fillStyle = THEME.text
  ctx.fillText('飞行棋', PANEL_X + PANEL_W / 2, 62)
  ctx.textAlign = 'left'
  const isTwo = state.playerCount === 2
  if (isTwo) {
    hudPair(ctx, PANEL_X, 92, '局数', state.round + '/3')
    hudPair(ctx, PANEL_X, 114, '局分', '你 ' + state.roundWinsYou + ' - ' + state.roundWinsAi + ' 黄')
  } else {
    hudPair(ctx, PANEL_X, 92, '人数', state.playerCount + ' 人')
    hudPair(ctx, PANEL_X, 114, '赛制', '单局定胜负')
  }
  const turnText = state.turn === 'you' ? '轮到你' : SIDE_NAME_AI(state.turn) + '行动中'
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.fillStyle = sideColor(state.turn)
  ctx.textAlign = 'left'
  ctx.fillText(turnText, PANEL_X, 138)
  const face = view.rolling ? view.rollingFace : state.dice ?? 0
  if (face > 0) drawDice(ctx, face, DICE_RECT.x + DICE_RECT.w / 2, DICE_RECT.y + DICE_RECT.h / 2, state.rolledSix && !view.rolling)
  const canRoll = state.phase === 'roll' && state.turn === 'you' && !view.rolling && !view.setup
  roundRectPath(ctx, ROLL_RECT.x, ROLL_RECT.y, ROLL_RECT.w, ROLL_RECT.h, 6)
  ctx.fillStyle = canRoll ? accent(0) : THEME.panel
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.stroke()
  ctx.fillStyle = canRoll ? '#15151b' : THEME.textMuted
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(view.rolling ? '掷骰中…' : '掷骰（空格）', ROLL_RECT.x + ROLL_RECT.w / 2, ROLL_RECT.y + 21)
  // 到终计数：按参战方逐行列出（色点 + 名称 + 计数）。
  const doneRows: Array<[string, string, string]> = []
  for (const side of state.sides) {
    let done = 0
    for (const p of state.pieces[side]) if (p === GOAL_POS) done += 1
    doneRows.push([side === 'you' ? '你到终' : SIDE_NAME_AI(side) + '到终', done + '/4', sideColor(side)])
  }
  ctx.textAlign = 'left'
  ctx.font = '600 12px system-ui, sans-serif'
  for (let i = 0; i < doneRows.length; i += 1) {
    const [label, val, color] = doneRows[i]!
    ctx.fillStyle = color
    ctx.fillText(label, PANEL_X, 296 + i * 20)
    ctx.fillStyle = THEME.text
    ctx.fillText(val, PANEL_X + 72, 296 + i * 20)
  }
  // 消息区：12px、定宽换行，最多 4 行，右边界不超过面板。
  ctx.font = '500 12px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = THEME.textMuted
  const maxWidth = PANEL_END_X - PANEL_X
  const lines: string[] = []
  let line = ''
  for (const ch of state.message) {
    if (ctx.measureText(line + ch).width > maxWidth) {
      lines.push(line)
      line = ch
      if (lines.length === 4) break
    } else {
      line += ch
    }
  }
  if (lines.length < 4 && line !== '') lines.push(line)
  const msgY = 296 + doneRows.length * 20 + 12
  for (let i = 0; i < lines.length; i += 1) {
    ctx.fillText(lines[i]!, PANEL_X, msgY + i * 18)
  }
}

/** AI 方中文名（HUD 短文案用）。 */
function SIDE_NAME_AI(side: Side): string {
  if (side === 'ai') return '黄方'
  if (side === 'blue') return '蓝方'
  if (side === 'green') return '绿方'
  return '你'
}

/** 说明按钮（渲染末尾、最上层）。 */
function drawHelpButton(ctx: CanvasRenderingContext2D, open: boolean): void {
  roundRectPath(ctx, HELP_RECT.x, HELP_RECT.y, HELP_RECT.w, HELP_RECT.h, 6)
  ctx.fillStyle = open ? accent(0) : THEME.panel
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = open ? '#15151b' : THEME.text
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(open ? '关闭' : '说明', HELP_RECT.x + HELP_RECT.w / 2, HELP_RECT.y + 16)
}

const HELP_LINES = [
  '你执红方，其余为电脑（黄/蓝/绿）；开局可选 2、3 或 4 人。',
  '2 人制 3 局 2 胜；3/4 人单局定胜负：先 4 架全部到终者即赢整场。',
  '掷出 6 才能起飞；起飞或行子掷到 6 都能额外再掷一次。',
  '棋子沿顺时针跑道前进，掷几点走几步（跑道共 52 格）。',
  '落到敌方棋子所在普通格：把对方全部送回机场（踩子）。',
  '带色格与星格是安全格：敌方不能踩入，己方可叠、不挨踩。',
  '进入终点直线后必须掷出恰好点数到达终点（第 6 格），多出的步数原路反弹。',
  '操作：空格或点骰子掷骰；点发光的飞机移动；悬停可预览落点；空格自动走最优。',
]

/** 帮助面板（渲染最末尾、盖在一切之上，任何阶段可开合）。 */
function drawHelpPanel(ctx: CanvasRenderingContext2D): void {
  const w = 640
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
  ctx.fillText('飞行棋 规则说明', LOGICAL_W / 2, y + 40)
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

/** 开局人数选择 overlay：2/3/4 人按钮，玩家恒执红。 */
function drawSetupOverlay(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = 'rgba(10,10,16,0.72)'
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H)
  const w = 300
  const h = 250
  const x = (LOGICAL_W - w) / 2
  const y = (LOGICAL_H - h) / 2 - 20
  roundRectPath(ctx, x, y, w, h, 10)
  ctx.fillStyle = 'rgba(20,20,30,0.97)'
  ctx.fill()
  ctx.strokeStyle = THEME.gold
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.font = 'bold 20px system-ui, sans-serif'
  ctx.fillStyle = THEME.text
  ctx.fillText('飞行棋 · 选择人数', LOGICAL_W / 2, y + 42)
  ctx.font = '500 12px system-ui, sans-serif'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('你执红方，其余为电脑 · 轮换按逆时针', LOGICAL_W / 2, y + 64)
  const labels: Record<number, string> = {
    2: '2 人（3 局 2 胜）',
    3: '3 人（单局定胜负）',
    4: '4 人（单局定胜负）',
  }
  for (const b of SETUP_BUTTONS) {
    roundRectPath(ctx, b.x, b.y, b.w, b.h, 8)
    ctx.fillStyle = accent(0)
    ctx.fill()
    ctx.strokeStyle = THEME.panelEdge
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = '#15151b'
    ctx.font = '700 15px system-ui, sans-serif'
    ctx.fillText(labels[b.count] ?? b.count + ' 人', b.x + b.w / 2, b.y + 27)
  }
}

/**
 * 整帧渲染：背景 → 盘面 → 棋子 → 悬停预览 → 回程幽灵 → HUD → 底部
 * 提示 → 暂停/胜负 overlay → 开局人数选择 overlay → 说明按钮 → 帮助
 * 面板（最后两步永远最上层）。
 * @param ctx - 已按逻辑坐标变换的 2d 上下文。
 * @param view - 本帧视图快照。
 */
export function renderLudo(ctx: CanvasRenderingContext2D, view: LudoView): void {
  drawBackground(ctx, LOGICAL_W, LOGICAL_H)
  drawBoard(ctx, view.state.sides)
  drawPieces(ctx, view.state, view.movable, view.now)
  if (!view.setup) drawHoverPreview(ctx, view)
  drawCaptureGhost(ctx, view)
  drawHud(ctx, view)
  ctx.textAlign = 'center'
  ctx.font = '500 12px system-ui, sans-serif'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('空格/点骰子掷骰 · 点高亮飞机移动 · 悬停预览落点 · R 重开 · P 暂停 · H 说明', BOARD_X + 7.5 * CELL, HINT_Y)
  if (view.setup) {
    drawSetupOverlay(ctx)
  } else if (view.paused && !view.userPaused) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '已暂停', '面板收起时自动暂停 · P 继续')
  } else if (view.userPaused) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '暂停中', '按 P 继续 · R 重开整场')
  } else if (view.state.phase === 'roundOver') {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, view.state.roundWinner === 'you' ? '你赢下本局' : '黄方赢下本局', '空格进入下一局', view.state.roundWinner === 'you' ? THEME.good : THEME.bad)
  } else if (view.state.phase === 'matchOver') {
    const win = view.state.matchWinner === 'you'
    const sub = view.state.playerCount === 2 ? '空格或点击再来一场' : '空格或点击再来一场（同人数）'
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, win ? '胜利！' : '惜败', sub, win ? THEME.gold : THEME.bad)
  }
  drawHelpButton(ctx, view.helpOpen)
  if (view.helpOpen) drawHelpPanel(ctx)
}
