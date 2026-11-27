/**
 * 「声呐探物 SonarDeduct」渲染层：深海声呐风。暗蓝网格海域，声呐格
 * 内嵌 8 向回声数字（零回声画 ·），插旗格画小旗（按 marks 分支），
 * 漂移鱼群为细长鱼影，声呐波纹为扩散圆环（view.ripples）。HUD：关卡、
 * 声呐余量、标记数、分数。帮助面板与「说明」按钮画在渲染函数末尾
 * （最上层），任何阶段可开合。全部纯函数绘制，不持有游戏状态。
 */
import { THEME, accent, drawBackground, drawOverlay, glow, hudPair, noGlow, roundRectPath } from '../theme.ts'
import type { ParticleSystem } from '../theme.ts'
import { DIRS, SIZE, fishPositions, markCount, obstacleCount, type SonarDeductState } from './logic.ts'

/** 单格边长（px）。 */
export const CELL = 46
/** 顶部 HUD 高度（px）。 */
export const HUD_H = 48
/** 网格左上角（含边距）。 */
export const GRID_X = 24
export const GRID_Y = 56
/** 逻辑画布尺寸（9×9 网格 + 边距）。 */
export const LOGICAL_W = GRID_X * 2 + SIZE * CELL
export const LOGICAL_H = GRID_Y + SIZE * CELL + 26

/** 「说明」按钮矩形（渲染在最上层，点击命中由 index.ts 复用本常量）。 */
export const HELP_RECT = { x: LOGICAL_W - 74, y: 8, w: 60, h: 24 }

/** 鼠标交互模式（index 维护）。 */
export type Mode = 'ping' | 'mark'

/** 一次声呐波纹（index 在 ping 成功时压入，逐帧推进）。 */
export interface Ripple {
  /** 网格坐标（格中心像素）。 */
  x: number
  y: number
  /** 已持续毫秒。 */
  age: number
}

/** 渲染所需的视图状态（由 index.ts 维护）。 */
export interface SonarDeductView {
  paused: boolean
  helpOpen: boolean
  /** 鼠标悬停格（逻辑格坐标），无则 null。 */
  hover: { r: number; c: number } | null
  mode: Mode
  /** 活跃波纹列表。 */
  ripples: Ripple[]
  particles: ParticleSystem
  /** 距上帧毫秒（推进粒子）。 */
  dtMs: number
}

/** 深海底色与网格线。 */
const SEA_FLOOR = '#141d2e'
const SEA_LINE = 'rgba(122,162,247,0.16)'
const SEA_PING = '#0f1626'
/** 回声数字颜色（蓝青），零回声的 · 用暗色。 */
const ECHO_COLOR = '#7dcfff'
const ECHO_ZERO = 'rgba(125,207,255,0.35)'
/** 插旗颜色（金）。 */
const FLAG_COLOR = '#e0af68'
/** 鱼影颜色。 */
const FISH_COLOR = 'rgba(187,154,247,0.55)'
/** 波纹颜色。 */
const RIPPLE_COLOR = 'rgba(125,207,255,'

/** 帮助面板的八行完整规则（15px 大字）。 */
const HELP_LINES: string[] = [
  '每关海床下藏着若干障碍，全部标出且无误标即过关。',
  '声呐模式点任意格：向 8 个方向各发出一道波。',
  '回声数字 = 该方向最近障碍的格数；· 表示无障碍。',
  '非零回声就直接定位了那个障碍格——标出来即可。',
  '标记模式点格插旗 / 拔旗；E 随时切换模式。',
  '旗数凑满自动判定：错旗立即拔掉并扣分。',
  '误标 3 次判负；声呐越省、误标越少分越高。',
  '鱼群只是干扰，回声只看静态障碍。R 重开 · P 暂停。',
]

/** 格中心像素坐标。 */
export function cellCenter(r: number, c: number): { px: number; py: number } {
  return { px: GRID_X + c * CELL + CELL / 2, py: GRID_Y + r * CELL + CELL / 2 }
}

/** 像素坐标 → 逻辑格坐标（越界返回 null）。 */
export function cellAt(px: number, py: number): { r: number; c: number } | null {
  if (px < GRID_X || py < GRID_Y) return null
  if (px >= GRID_X + SIZE * CELL || py >= GRID_Y + SIZE * CELL) return null
  return { r: Math.floor((py - GRID_Y) / CELL), c: Math.floor((px - GRID_X) / CELL) }
}

/** 顶部 HUD：左三组计数，右侧分数（右锚避开说明按钮）。 */
function drawHud(ctx: CanvasRenderingContext2D, state: SonarDeductState, view: SonarDeductView): void {
  hudPair(ctx, 12, 24, '关卡 ', state.level + '/5')
  hudPair(ctx, 110, 24, '声呐 ', String(state.budget), 'left', state.budget <= 1 ? THEME.bad : THEME.text)
  hudPair(ctx, 195, 24, '标记 ', markCount(state) + '/' + obstacleCount(state))
  hudPair(ctx, 382, 24, '分数 ', String(Math.max(0, state.score)), 'right', THEME.gold)
  ctx.font = '600 11px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = THEME.textMuted
  const hint = view.mode === 'ping'
    ? '声呐模式：左键发波 · E 切标记 · R 重开 · P 暂停'
    : '标记模式：左键插旗 / 拔旗 · E 切声呐 · R 重开 · P 暂停'
  ctx.fillText(hint, 12, 44)
}

/** 声呐格：中心换能器 + 胞内 8 向回声数字（零画 ·）。 */
function drawPingCell(ctx: CanvasRenderingContext2D, r: number, c: number, echo: number[]): void {
  const { px, py } = cellCenter(r, c)
  ctx.fillStyle = SEA_PING
  ctx.fillRect(GRID_X + c * CELL + 1, GRID_Y + r * CELL + 1, CELL - 2, CELL - 2)
  ctx.fillStyle = ECHO_COLOR
  ctx.font = '700 10px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let i = 0; i < DIRS.length; i += 1) {
    const d = DIRS[i]!
    const value = echo[i]!
    const nx = px + d.dc * 15
    const ny = py + d.dr * 15
    if (value <= 0) {
      ctx.fillStyle = ECHO_ZERO
      ctx.fillText('·', nx, ny)
    } else {
      ctx.fillStyle = ECHO_COLOR
      ctx.fillText(String(value), nx, ny)
    }
  }
  ctx.fillStyle = ECHO_COLOR
  ctx.beginPath()
  ctx.arc(px, py, 3, 0, Math.PI * 2)
  ctx.fill()
  ctx.textBaseline = 'alphabetic'
}

/** 插旗格：金色小旗（旗杆 + 三角旗面）。 */
function drawFlag(ctx: CanvasRenderingContext2D, r: number, c: number): void {
  const { px, py } = cellCenter(r, c)
  glow(ctx, FLAG_COLOR, 8)
  ctx.strokeStyle = FLAG_COLOR
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(px - 2, py + 10)
  ctx.lineTo(px - 2, py - 10)
  ctx.stroke()
  ctx.fillStyle = FLAG_COLOR
  ctx.beginPath()
  ctx.moveTo(px - 1, py - 10)
  ctx.lineTo(px + 12, py - 5)
  ctx.lineTo(px - 1, py)
  ctx.closePath()
  ctx.fill()
  noGlow(ctx)
}

/** 失败复盘：真实障碍格画红叉。 */
function drawTruth(ctx: CanvasRenderingContext2D, state: SonarDeductState): void {
  ctx.strokeStyle = THEME.bad
  ctx.lineWidth = 3
  for (let r = 0; r < SIZE; r += 1) {
    for (let c = 0; c < SIZE; c += 1) {
      if (state.obstacles[r * SIZE + c] !== 1) continue
      const { px, py } = cellCenter(r, c)
      ctx.beginPath()
      ctx.moveTo(px - 8, py - 8)
      ctx.lineTo(px + 8, py + 8)
      ctx.moveTo(px + 8, py - 8)
      ctx.lineTo(px - 8, py + 8)
      ctx.stroke()
    }
  }
}

/** 漂移鱼群：细长鱼影（身 + 尾），按速度方向朝向。 */
function drawFish(ctx: CanvasRenderingContext2D, state: SonarDeductState): void {
  const pos = fishPositions(state)
  for (let i = 0; i < state.fish.length; i += 1) {
    const f = state.fish[i]!
    const p = pos[i]!
    const x = GRID_X + p.x * CELL
    const y = GRID_Y + p.y * CELL
    const dir = f.vx >= 0 ? 1 : -1
    ctx.fillStyle = FISH_COLOR
    ctx.beginPath()
    ctx.ellipse(x, y, 7, 3, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(x - dir * 6, y)
    ctx.lineTo(x - dir * 12, y - 4)
    ctx.lineTo(x - dir * 12, y + 4)
    ctx.closePath()
    ctx.fill()
  }
}

/** 声呐波纹：扩散圆环（600ms 淡出）。 */
function drawRipples(ctx: CanvasRenderingContext2D, view: SonarDeductView): void {
  for (const rp of view.ripples) {
    const k = Math.min(1, rp.age / 600)
    const alpha = 0.5 * (1 - k)
    if (alpha <= 0) continue
    ctx.strokeStyle = RIPPLE_COLOR + alpha.toFixed(3) + ')'
    ctx.lineWidth = 2
    for (let ring = 0; ring < 3; ring += 1) {
      const rk = Math.max(0, k - ring * 0.18)
      if (rk <= 0) continue
      ctx.beginPath()
      ctx.arc(rp.x, rp.y, 8 + rk * 120, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
}

/**
 * 渲染一帧。调用顺序：背景 → HUD → 网格底盘 →（按格显式分支：声呐格
 * 画回声 / 插旗格画旗 / 空格留底）→ 悬停高亮 → 波纹 → 鱼群 → 粒子 →
 * 失败复盘红叉 → 胜负/暂停遮罩 → 帮助面板与「说明」按钮（最后，
 * 最上层）。
 * @param ctx 画布上下文（已套逻辑坐标变换）。
 * @param state 当前局面。
 * @param view 视图状态。
 */
export function renderSonar(ctx: CanvasRenderingContext2D, state: SonarDeductState, view: SonarDeductView): void {
  drawBackground(ctx, LOGICAL_W, LOGICAL_H)
  drawHud(ctx, state, view)

  // 网格底盘。
  ctx.fillStyle = SEA_FLOOR
  ctx.fillRect(GRID_X, GRID_Y, SIZE * CELL, SIZE * CELL)
  ctx.strokeStyle = SEA_LINE
  ctx.lineWidth = 1
  for (let i = 0; i <= SIZE; i += 1) {
    ctx.beginPath()
    ctx.moveTo(GRID_X + i * CELL + 0.5, GRID_Y)
    ctx.lineTo(GRID_X + i * CELL + 0.5, GRID_Y + SIZE * CELL)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(GRID_X, GRID_Y + i * CELL + 0.5)
    ctx.lineTo(GRID_X + SIZE * CELL, GRID_Y + i * CELL + 0.5)
    ctx.stroke()
  }

  // 逐格显式分支：声呐格（已发波）→ 插旗格（已标）→ 空格（未动）。
  const pinged = new Map<string, number[]>()
  for (const p of state.pings) pinged.set(p.r + ',' + p.c, p.echo)
  for (let r = 0; r < SIZE; r += 1) {
    for (let c = 0; c < SIZE; c += 1) {
      const echo = pinged.get(r + ',' + c)
      if (echo !== undefined) {
        drawPingCell(ctx, r, c, echo)
      } else if (state.marks[r * SIZE + c] === 1) {
        drawFlag(ctx, r, c)
      }
      // 空格：只留深海底色，不画任何标记。
    }
  }

  // 悬停高亮（仅进行中）。
  if (view.hover !== null && state.status === 'playing' && !view.paused) {
    const hx = GRID_X + view.hover.c * CELL
    const hy = GRID_Y + view.hover.r * CELL
    ctx.strokeStyle = view.mode === 'ping' ? ECHO_COLOR : FLAG_COLOR
    ctx.lineWidth = 2
    ctx.strokeRect(hx + 1, hy + 1, CELL - 2, CELL - 2)
  }

  drawRipples(ctx, view)
  drawFish(ctx, state)
  view.particles.tick(ctx, view.dtMs)

  // 失败复盘：先画真实障碍红叉再盖遮罩（隐约可见位置）。
  if (state.status === 'gameover') drawTruth(ctx, state)

  // 遮罩：胜负 / 暂停 / 过关推进。
  if (view.paused) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '暂停', '按 P 继续 · R 重开本关')
  } else if (state.status === 'levelClear') {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '第 ' + state.level + ' 关完成', '全部障碍已标出 · 点网格或按 E 进入下一关', THEME.good)
  } else if (state.status === 'allClear') {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '海域清空', '五关全部标完 · 按 R 再来一轮 · 本关 +误标 ' + state.wrong + ' 次', THEME.gold)
  } else if (state.status === 'gameover') {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '误标过多', '错旗 3 次判负 · 红叉为真实障碍 · 按 R 重开本关', THEME.bad)
  }

  // 帮助面板（任何阶段可开合，盖在遮罩之上）。仅画板，无状态。
  if (view.helpOpen) {
    ctx.fillStyle = 'rgba(13,13,20,0.86)'
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H)
    roundRectPath(ctx, 30, 54, LOGICAL_W - 60, 300, 12)
    ctx.fillStyle = THEME.panel
    ctx.fill()
    ctx.strokeStyle = THEME.panelEdge
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.font = 'bold 17px system-ui, sans-serif'
    ctx.fillStyle = THEME.text
    ctx.fillText('声呐探物 · 规则说明', LOGICAL_W / 2, 84)
    ctx.font = '600 15px system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillStyle = THEME.text
    for (let i = 0; i < HELP_LINES.length; i += 1) {
      ctx.fillText(HELP_LINES[i]!, 52, 114 + i * 24)
    }
  }

  // 「说明」按钮永远画在最后一层，保证任何阶段可见可点。
  roundRectPath(ctx, HELP_RECT.x, HELP_RECT.y, HELP_RECT.w, HELP_RECT.h, 6)
  ctx.fillStyle = view.helpOpen ? accent(0) : THEME.panel
  ctx.fill()
  ctx.strokeStyle = view.helpOpen ? accent(0) : THEME.panelEdge
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = view.helpOpen ? '#15151b' : THEME.text
  ctx.fillText('说明', HELP_RECT.x + HELP_RECT.w / 2, HELP_RECT.y + HELP_RECT.h / 2)
  ctx.textBaseline = 'alphabetic'
}
