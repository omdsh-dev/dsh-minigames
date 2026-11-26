/**
 * 「提灯人 Lamplight」渲染层：夜晚小镇。黑幕之上有两类光源——
 * 玩家油灯（径向暖光，半径随油量缩圈、灯焰随时间抖动）与已点亮
 * 路灯（金色立柱 + 恒定光晕）。去过的格子留暗色记忆轮廓（seen），
 * 暗影只在被照亮时显形（紫雾）。HUD：关卡、已点/总路灯数、油量条。
 * 帮助面板与「说明」按钮画在渲染函数末尾（最上层），任何阶段可开合。
 * 全部绘制为纯函数，不持有游戏状态（粒子池由 index.ts 注入）。
 */
import { THEME, accent, drawBackground, drawOverlay, glow, hudPair, noGlow, roundRectPath } from '../theme.ts'
import type { ParticleSystem } from '../theme.ts'
import { LAMP_LIT_RADIUS, lampRadius, type LamplightState } from './logic.ts'

/** 单格边长（px）。 */
export const CELL = 32
/** 顶部 HUD 高度（px）。 */
export const HUD_H = 48
/** 最大关卡盘面（19×15）决定逻辑画布尺寸；小盘面居中。 */
export const MAX_COLS = 19
export const MAX_ROWS = 15
export const LOGICAL_W = MAX_COLS * CELL
export const LOGICAL_H = HUD_H + MAX_ROWS * CELL

/** 「说明」按钮矩形（渲染在最上层，点击命中由 index.ts 复用本常量）。 */
export const HELP_RECT = { x: LOGICAL_W - 74, y: 8, w: 60, h: 24 }

/** 油量条矩形（HUD 右侧，左端含标签，右端距说明按钮留 34px）。 */
const OIL_BAR = { x: 320, y: 10, w: 180, h: 12 }

/** 灯焰颜色（暖金）。 */
const FLAME_COLOR = '#ffd29a'
/** 路灯恒定光色。 */
const LAMP_COLOR = '#e0af68'
/** 暗影雾色。 */
const SHADOW_COLOR = '#bb9af7'
/** 记忆轮廓（去过但当前不亮）地板色。 */
const MEMORY_FLOOR = 'rgba(122,162,247,0.07)'
/** 记忆建筑色。 */
const MEMORY_WALL = '#232334'

/** 帮助面板的八行完整规则（15px 大字）。 */
const HELP_LINES: string[] = [
  '方向键/WASD 四向移动；每走一步消耗 1 格灯油。',
  '油量决定灯圈：≥8 格照 2.5、≥5 照 2、≥3 照 1.5、≥1 只照 1。',
  '走到路灯格即点亮；路灯永久照亮周围 2 格，是黑暗中的驿站。',
  '点亮全部路灯过关；灯油耗尽即失败，按 R 用同一地形重开。',
  '绿色油瓶格补给 +2 格灯油，每瓶只能取一次。',
  '走出光圈即变黑，但去过的格子会留暗色记忆轮廓可凭记忆赶路。',
  '第 3 关起出现暗影：只在与你相邻（含斜向）时追击，接触会',
  '熄灭你最近点亮的一盏路灯并退远。R 重开 · P 暂停。',
]

/** 渲染所需的视图状态（由 index.ts 维护）。 */
export interface LamplightView {
  /** 暂停中（画暂停遮罩）。 */
  paused: boolean
  /** 帮助面板是否展开。 */
  helpOpen: boolean
  /** 粒子系统（由 index 持有，此处只负责按帧推进）。 */
  particles: ParticleSystem
  /** 距上帧毫秒（推进粒子）。 */
  dtMs: number
}

/** 盘面左上角（按当前关尺寸在最大画布内居中，含 HUD 边距）。 */
export function gridOffset(state: LamplightState): { ox: number; oy: number } {
  return {
    ox: Math.floor(((MAX_COLS - state.cols) / 2) * CELL),
    oy: HUD_H + Math.floor(((MAX_ROWS - state.rows) / 2) * CELL),
  }
}

/** 格中心像素坐标。 */
export function cellCenter(state: LamplightState, x: number, y: number): { px: number; py: number } {
  const { ox, oy } = gridOffset(state)
  return { px: ox + x * CELL + CELL / 2, py: oy + y * CELL + CELL / 2 }
}

/** 顶部 HUD：左关卡、中路灯计数、右侧油量条（避开说明按钮）。 */
function drawHud(ctx: CanvasRenderingContext2D, state: LamplightState): void {
  const lit = state.litOrder.length
  hudPair(ctx, 12, 24, '关卡 ', state.level + '/5')
  hudPair(ctx, 110, 24, '路灯 ', lit + '/' + state.lamps.length, 'left', lit === state.lamps.length ? THEME.good : THEME.text)
  hudPair(ctx, 230, 24, '灯油 ', state.oil + '/' + state.oilStart, 'left', state.oil <= 3 ? THEME.bad : THEME.gold)
  // 油量条：底槽 + 比例填充（油少转红）。
  const ratio = Math.max(0, Math.min(1, state.oil / state.oilStart))
  roundRectPath(ctx, OIL_BAR.x, OIL_BAR.y, OIL_BAR.w, OIL_BAR.h, 6)
  ctx.fillStyle = 'rgba(255,255,255,0.06)'
  ctx.fill()
  if (ratio > 0) {
    roundRectPath(ctx, OIL_BAR.x, OIL_BAR.y, Math.max(OIL_BAR.h, OIL_BAR.w * ratio), OIL_BAR.h, 6)
    ctx.fillStyle = state.oil <= 3 ? THEME.bad : THEME.gold
    ctx.fill()
  }
  ctx.font = '600 11px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('方向键/WASD 移动 · R 重开 · P 暂停 · 点「说明」看完整规则', 12, 42)
}

/** 画一个径向光晕光源（叠加混合，中心亮边缘透明）。 */
function drawLight(ctx: CanvasRenderingContext2D, px: number, py: number, radiusPx: number, color: string, alpha: number): void {
  if (radiusPx <= 1) return
  const g = ctx.createRadialGradient(px, py, 0, px, py, radiusPx)
  const rgb = color === FLAME_COLOR ? '255,210,154' : '224,175,104'
  g.addColorStop(0, 'rgba(' + rgb + ',' + alpha + ')')
  g.addColorStop(0.55, 'rgba(' + rgb + ',' + (alpha * 0.45) + ')')
  g.addColorStop(1, 'rgba(' + rgb + ',0)')
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(px, py, radiusPx, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalCompositeOperation = 'source-over'
}

/**
 * 渲染一帧。调用顺序：背景 → HUD → 记忆地板/建筑 → 光源（油灯 + 路灯）
 * → 路灯立柱/油瓶/暗影/玩家 → 粒子 → 胜负/暂停遮罩 → 帮助面板与
 * 「说明」按钮（最后，最上层）。
 * @param ctx 画布上下文（已套逻辑坐标变换）。
 * @param state 当前局面。
 * @param view 视图状态。
 */
export function renderLamplight(ctx: CanvasRenderingContext2D, state: LamplightState, view: LamplightView): void {
  const now = typeof performance !== 'undefined' ? performance.now() : 0
  const { ox, oy } = gridOffset(state)
  drawBackground(ctx, LOGICAL_W, LOGICAL_H)
  drawHud(ctx, state)

  // 夜幕基底：整个盘面区域近乎全黑。
  ctx.fillStyle = 'rgba(4,4,10,0.92)'
  ctx.fillRect(ox, oy, state.cols * CELL, state.rows * CELL)

  // 记忆层：被照亮过的格子（seen）画暗色轮廓，建筑更深。
  for (let y = 0; y < state.rows; y += 1) {
    for (let x = 0; x < state.cols; x += 1) {
      if (state.seen[y * state.cols + x] !== 1) continue
      const px = ox + x * CELL
      const py = oy + y * CELL
      if (state.walls[y * state.cols + x] === 1) {
        ctx.fillStyle = MEMORY_WALL
        ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2)
        ctx.strokeStyle = 'rgba(122,162,247,0.10)'
        ctx.lineWidth = 1
        ctx.strokeRect(px + 1.5, py + 1.5, CELL - 3, CELL - 3)
      } else {
        ctx.fillStyle = MEMORY_FLOOR
        ctx.fillRect(px, py, CELL, CELL)
      }
    }
  }

  // 光源层：每盏已点亮路灯的恒定光晕（半径 2 格）。
  for (const lamp of state.lamps) {
    if (!lamp.lit) continue
    const { px, py } = cellCenter(state, lamp.x, lamp.y)
    drawLight(ctx, px, py, LAMP_LIT_RADIUS * CELL + 6, LAMP_COLOR, 0.5)
  }

  // 玩家油灯光晕：半径随油量缩圈，灯焰随时间抖动。
  const radius = lampRadius(state.oil)
  const flicker = 0.42 + 0.07 * Math.sin(now * 0.011) + 0.04 * Math.sin(now * 0.037 + 1.7)
  const { px: ppx, py: ppy } = cellCenter(state, state.player.x, state.player.y)
  drawLight(ctx, ppx, ppy, Math.max(CELL * 0.6, radius * CELL + 4), FLAME_COLOR, flicker)

  // 实体层。
  for (const lamp of state.lamps) {
    const { px, py } = cellCenter(state, lamp.x, lamp.y)
    const visible = state.seen[lamp.y * state.cols + lamp.x] === 1
    if (!visible && !lamp.lit) continue
    // 立柱：底座 + 柱身 + 灯头。
    ctx.strokeStyle = lamp.lit ? LAMP_COLOR : '#4a4a62'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(px, py + CELL / 2 - 3)
    ctx.lineTo(px, py - CELL / 2 + 7)
    ctx.stroke()
    if (lamp.lit) {
      glow(ctx, LAMP_COLOR, 12)
      ctx.fillStyle = '#ffe9b8'
      ctx.beginPath()
      ctx.arc(px, py - CELL / 2 + 7, 4.5, 0, Math.PI * 2)
      ctx.fill()
      noGlow(ctx)
    } else {
      ctx.fillStyle = '#5a5a76'
      ctx.beginPath()
      ctx.arc(px, py - CELL / 2 + 7, 4, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  for (const bottle of state.bottles) {
    if (bottle.taken) continue
    if (state.seen[bottle.y * state.cols + bottle.x] !== 1) continue
    const { px, py } = cellCenter(state, bottle.x, bottle.y)
    glow(ctx, THEME.good, 8)
    ctx.fillStyle = '#9ece6a'
    roundRectPath(ctx, px - 5, py - 9, 10, 16, 3)
    ctx.fill()
    noGlow(ctx)
    ctx.fillStyle = '#c5e8a0'
    ctx.fillRect(px - 2, py - 12, 4, 4)
  }

  // 暗影：只在被照亮过的格子（seen）上显形（紫雾团，缓慢蠕动）。
  for (const shadow of state.shadows) {
    const idx = shadow.y * state.cols + shadow.x
    if (state.seen[idx] !== 1) continue
    const litHere = radius > 0 && (shadow.x - state.player.x) ** 2 + (shadow.y - state.player.y) ** 2 <= radius * radius
    let lampLitHere = false
    for (const lamp of state.lamps) {
      if (!lamp.lit) continue
      if ((shadow.x - lamp.x) ** 2 + (shadow.y - lamp.y) ** 2 <= LAMP_LIT_RADIUS * LAMP_LIT_RADIUS) { lampLitHere = true; break }
    }
    const { px, py } = cellCenter(state, shadow.x, shadow.y)
    const wob = Math.sin(now * 0.004 + shadow.id * 2.1) * 3
    ctx.globalAlpha = litHere || lampLitHere ? 0.85 : 0.3
    glow(ctx, SHADOW_COLOR, 14)
    ctx.fillStyle = 'rgba(187,154,247,0.55)'
    ctx.beginPath()
    ctx.arc(px + wob, py, 10, 0, Math.PI * 2)
    ctx.arc(px - wob * 0.5, py + 3, 7, 0, Math.PI * 2)
    ctx.fill()
    noGlow(ctx)
    ctx.globalAlpha = 1
    ctx.fillStyle = '#f2e8ff'
    ctx.beginPath()
    ctx.arc(px - 3 + wob * 0.3, py - 2, 1.6, 0, Math.PI * 2)
    ctx.arc(px + 3 + wob * 0.3, py - 2, 1.6, 0, Math.PI * 2)
    ctx.fill()
  }

  // 玩家：提灯小人（暖色圆点 + 灯焰）。未被暗影接触惩罚遮盖。
  glow(ctx, FLAME_COLOR, 10)
  ctx.fillStyle = '#ffd29a'
  ctx.beginPath()
  ctx.arc(ppx, ppy, 7, 0, Math.PI * 2)
  ctx.fill()
  noGlow(ctx)
  ctx.fillStyle = '#3a2c1a'
  ctx.beginPath()
  ctx.arc(ppx, ppy, 3, 0, Math.PI * 2)
  ctx.fill()

  view.particles.tick(ctx, view.dtMs)

  // 遮罩：胜负 / 暂停。
  if (view.paused) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '暂停', '按 P 继续 · R 重开本关')
  } else if (state.status === 'levelClear') {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '第 ' + state.level + ' 关完成', '全部路灯已点亮 · 按方向键进入下一关', THEME.good)
  } else if (state.status === 'allClear') {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '小镇通明', '五关全部点亮 · 按 R 再来一轮 · 本关 ' + state.moves + ' 步', THEME.gold)
  } else if (state.status === 'gameover') {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '灯油耗尽', '已点亮 ' + state.litOrder.length + '/' + state.lamps.length + ' 盏 · 按 R 重开本关', THEME.bad)
  }

  // 帮助面板（任何阶段可开合，盖在遮罩之上）。仅画板，无状态。
  if (view.helpOpen) {
    ctx.fillStyle = 'rgba(13,13,20,0.86)'
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H)
    roundRectPath(ctx, 36, 56, 536, 270, 12)
    ctx.fillStyle = THEME.panel
    ctx.fill()
    ctx.strokeStyle = THEME.panelEdge
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.font = 'bold 17px system-ui, sans-serif'
    ctx.fillStyle = THEME.text
    ctx.fillText('提灯人 · 规则说明', LOGICAL_W / 2, 86)
    ctx.font = '600 15px system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillStyle = THEME.text
    for (let i = 0; i < HELP_LINES.length; i += 1) {
      ctx.fillText(HELP_LINES[i]!, 58, 116 + i * 24)
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
