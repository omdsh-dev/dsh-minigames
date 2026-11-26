/**
 * 海豚跃浪渲染层：日落渐变天、太阳、动画波浪线、贝塞尔海豚（跟随
 * 速度方向 + 空翻旋转）、漂移水母、入水水花（越陡越高）、蓄力条与
 * 角度、连击火花、轮次/得分/风速 HUD、暂停/结束遮罩，以及最上层的
 * 「说明」按钮与帮助面板。纯绘制，不持有游戏逻辑状态。
 */
import {
  WATER_Y, ROUNDS, comboMultiplier,
  type DolphinDiveState, type Jellyfish,
} from './logic.ts'
import {
  THEME, accent, drawOverlay, glow, noGlow, hudPair,
  roundRectPath,
} from '../theme.ts'
import type { ParticleSystem } from '../theme.ts'

/** 逻辑画布尺寸。 */
export const LOGICAL_W = 520
export const LOGICAL_H = 340
/** 「说明」按钮矩形（渲染在最上层，index.ts 点击命中复用本常量）。 */
export const HELP_RECT = { x: LOGICAL_W - 74, y: 8, w: 60, h: 24 }

/** 渲染层视图状态（index.ts 维护）。 */
export interface DolphinView {
  /** 帮助面板是否展开。 */
  helpOpen: boolean
  /** 暂停中。 */
  paused: boolean
  /** 波浪动画累计毫秒。 */
  timeMs: number
  /** 粒子系统（index 持有，渲染时推进）。 */
  particles: ParticleSystem
}

/** 帮助面板的八行完整规则。 */
const HELP_LINES: string[] = [
  '共 5 轮表演：按住空格蓄力（速度越蓄越快），松开跃出。',
  '跃出前 ↑↓ 微调起跳角（20°..85°）：越陡越接近垂直入水。',
  '空中再按空格翻滚：每完成一圈 +8 分。',
  '翻滚未完成就入水会被打折——别转太多。',
  '入水角决定得分：垂直入水最高，拍水面几乎无分。',
  '连续完美入水连击：每次 +0.5 倍率，封顶 3 倍。',
  '碰水母一次 -15 分并清空连击；每轮风速不同，注意水平漂移。',
  'R 重开、P 暂停；本说明任何阶段都可开合。',
]

/** 天空/海面渐变按 context 缓存（避免每帧重建）。 */
const skyCache = new WeakMap<CanvasRenderingContext2D, CanvasGradient>()
const seaCache = new WeakMap<CanvasRenderingContext2D, CanvasGradient>()

/** 日落背景：上紫下橙的天空 + 太阳 + 深蓝海面。 */
function drawSkySea(ctx: CanvasRenderingContext2D): void {
  let sky = skyCache.get(ctx)
  if (sky === undefined) {
    sky = ctx.createLinearGradient(0, 0, 0, WATER_Y)
    sky.addColorStop(0, '#2a1f3f')
    sky.addColorStop(0.55, '#6b3a5a')
    sky.addColorStop(1, '#d97a4f')
    skyCache.set(ctx, sky)
  }
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, LOGICAL_W, WATER_Y)
  glow(ctx, THEME.gold, 30)
  ctx.fillStyle = '#f2b874'
  ctx.beginPath()
  ctx.arc(LOGICAL_W - 86, WATER_Y - 58, 26, 0, Math.PI * 2)
  ctx.fill()
  noGlow(ctx)
  let sea = seaCache.get(ctx)
  if (sea === undefined) {
    sea = ctx.createLinearGradient(0, WATER_Y, 0, LOGICAL_H)
    sea.addColorStop(0, '#1b4f72')
    sea.addColorStop(1, '#0d2438')
    seaCache.set(ctx, sea)
  }
  ctx.fillStyle = sea
  ctx.fillRect(0, WATER_Y, LOGICAL_W, LOGICAL_H - WATER_Y)
}

/** 两道正弦波浪线（随 timeMs 平移）。 */
function drawWaves(ctx: CanvasRenderingContext2D, timeMs: number): void {
  for (let k = 0; k < 2; k += 1) {
    ctx.beginPath()
    const phase = timeMs / 900 + k * 2.4
    for (let x = 0; x <= LOGICAL_W; x += 8) {
      const y = WATER_Y + 2 + k * 7 + Math.sin(x / 34 + phase) * (3.5 - k)
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = k === 0 ? 'rgba(125,207,255,0.75)' : 'rgba(125,207,255,0.35)'
    ctx.lineWidth = k === 0 ? 2 : 1.4
    ctx.stroke()
  }
}

/** 一只水母：半透明粉色圆顶 + 波动触须（碰过后变暗）。 */
function drawJelly(ctx: CanvasRenderingContext2D, j: Jellyfish, timeMs: number): void {
  const pulse = 1 + Math.sin(timeMs / 260 + j.x) * 0.08
  ctx.save()
  ctx.translate(j.x, j.y)
  ctx.globalAlpha = j.hit ? 0.28 : 0.9
  glow(ctx, '#f7768e', 10)
  ctx.fillStyle = j.hit ? '#5a4650' : '#f7768e'
  ctx.beginPath()
  ctx.arc(0, 0, j.r * pulse, Math.PI, 0)
  ctx.closePath()
  ctx.fill()
  noGlow(ctx)
  ctx.strokeStyle = j.hit ? '#5a4650' : 'rgba(247,118,142,0.7)'
  ctx.lineWidth = 1.6
  for (let t = 0; t < 4; t += 1) {
    const bx = -j.r * 0.6 + t * (j.r * 0.4)
    ctx.beginPath()
    ctx.moveTo(bx, 0)
    ctx.quadraticCurveTo(bx + Math.sin(timeMs / 300 + t) * 4, 8, bx, 16)
    ctx.stroke()
  }
  ctx.restore()
  ctx.globalAlpha = 1
}

/**
 * 一条海豚：贝塞尔身体 + 尾鳍 + 背鳍 + 浅色肚皮 + 眼睛，绕自身中心旋转。
 * @param ctx 上下文。
 * @param x 中心横坐标（已钳制到画面内）。
 * @param y 中心纵坐标。
 * @param rot 旋转弧度（0 = 头朝右水平）。
 * @param bob 水下摆动偏移。
 */
function drawDolphin(ctx: CanvasRenderingContext2D, x: number, y: number, rot: number, bob: number): void {
  ctx.save()
  ctx.translate(x, y + bob)
  ctx.rotate(rot)
  glow(ctx, '#7dcfff', 12)
  ctx.fillStyle = '#7dcfff'
  ctx.beginPath()
  ctx.moveTo(24, 0)
  ctx.quadraticCurveTo(4, -11, -20, -3)
  ctx.quadraticCurveTo(-24, -1, -24, 0)
  ctx.quadraticCurveTo(-24, 1, -20, 3)
  ctx.quadraticCurveTo(4, 11, 24, 0)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(-19, -2)
  ctx.quadraticCurveTo(-30, -12, -33, -6)
  ctx.quadraticCurveTo(-27, -2, -26, 0)
  ctx.quadraticCurveTo(-27, 2, -33, 6)
  ctx.quadraticCurveTo(-30, 12, -19, 2)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(2, -8)
  ctx.quadraticCurveTo(0, -18, -8, -14)
  ctx.quadraticCurveTo(-4, -10, -6, -7)
  ctx.closePath()
  ctx.fill()
  noGlow(ctx)
  ctx.fillStyle = '#c8e6ff'
  ctx.beginPath()
  ctx.moveTo(22, 1)
  ctx.quadraticCurveTo(4, 9, -18, 3)
  ctx.quadraticCurveTo(4, 5, 22, 1)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#15151b'
  ctx.beginPath()
  ctx.arc(15, -2, 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(21,21,27,0.5)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(24, 0)
  ctx.quadraticCurveTo(18, 3, 13, 2)
  ctx.stroke()
  ctx.restore()
}

/** 顶部 HUD：三列左锚（轮次/得分/连击），右侧风速右锚，避开说明按钮。 */
function drawHud(ctx: CanvasRenderingContext2D, state: DolphinDiveState): void {
  hudPair(ctx, 14, 24, '轮次 ', state.round + '/' + ROUNDS, 'left', THEME.text)
  hudPair(ctx, 112, 24, '得分 ', String(state.score), 'left', THEME.gold)
  const comboText = state.combo > 0 ? state.combo + '连 x' + comboMultiplier(state.combo) : '—'
  hudPair(ctx, 224, 24, '连击 ', comboText, 'left', THEME.good)
  const w = Math.round(Math.abs(state.wind))
  const windText = (state.wind >= 0 ? '→' : '←') + w
  hudPair(ctx, HELP_RECT.x - 10, 24, '风速 ', windText, 'right', accent(3))
}

/** 蓄力条 + 角度读数（左上，HUD 下方；仅水下游动/蓄力阶段）。 */
function drawCharge(ctx: CanvasRenderingContext2D, state: DolphinDiveState): void {
  if (state.phase !== 'swim' && state.phase !== 'charge') return
  ctx.fillStyle = THEME.panelEdge
  roundRectPath(ctx, 20, 40, 140, 10, 5)
  ctx.fill()
  if (state.power > 0.01) {
    glow(ctx, accent(0), 6)
    ctx.fillStyle = accent(0)
    roundRectPath(ctx, 20, 40, Math.max(6, 140 * state.power), 10, 5)
    ctx.fill()
    noGlow(ctx)
  }
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('角度 ' + Math.round(state.angleDeg) + '° · ↑↓ 调整', 20, 64)
}

/** 底部居中状态提示。 */
function drawHint(ctx: CanvasRenderingContext2D, state: DolphinDiveState): void {
  let hint = ''
  if (state.phase === 'swim') hint = '按住空格蓄力 · ↑↓ 调起跳角'
  else if (state.phase === 'charge') hint = '松开空格跃出！'
  else if (state.phase === 'air') hint = '空格空翻 · 小心水母'
  else if (state.phase === 'settle') hint = state.lastEntryLabel + '  +' + state.lastRoundPoints
  else hint = '总分 ' + state.score + ' · 按 R 重新开始'
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText(hint, LOGICAL_W / 2, 330)
}

/** 跨帧观察上一阶段（入水瞬间触发水花）。 */
let lastPhase: string = 'swim'

/**
 * 渲染一帧。
 * @param ctx 画布上下文（已套逻辑坐标变换）。
 * @param state 游戏局面。
 * @param view 视图状态。
 * @param dtMs 距上帧毫秒（推进粒子与波浪）。
 */
export function renderDolphinDive(
  ctx: CanvasRenderingContext2D,
  state: DolphinDiveState,
  view: DolphinView,
  dtMs: number,
): void {
  view.timeMs += dtMs
  const prevPhase = lastPhase
  lastPhase = state.phase

  drawSkySea(ctx)
  drawWaves(ctx, view.timeMs)
  for (const j of state.jellyfish) drawJelly(ctx, j, view.timeMs)

  let rot = 0
  let bob = 0
  if (state.phase === 'air') {
    rot = Math.atan2(state.vy, state.vx) + state.rotation
  } else if (state.phase === 'swim' || state.phase === 'charge') {
    bob = Math.sin(view.timeMs / 380) * 2
  }
  const dx = Math.min(LOGICAL_W - 30, Math.max(30, state.x))
  drawDolphin(ctx, dx, state.y, rot, bob)

  if (state.phase === 'charge') {
    ctx.strokeStyle = 'rgba(125,207,255,0.5)'
    ctx.lineWidth = 2
    for (let i = 0; i < 3; i += 1) {
      const len = 14 + state.power * 46 + i * 8
      ctx.beginPath()
      ctx.moveTo(dx - 28 - len, state.y - 6 + i * 6)
      ctx.lineTo(dx - 28, state.y - 6 + i * 6)
      ctx.stroke()
    }
  }

  drawHud(ctx, state)
  drawCharge(ctx, state)

  if (prevPhase === 'air' && state.phase === 'settle') {
    const s = state.entrySteepness
    view.particles.burst(dx, WATER_Y, '#7dcfff', 8 + Math.round(26 * s), 90 + 220 * s)
    if (s >= 0.9 && !state.entrySloppy) {
      view.particles.burst(dx, WATER_Y - 10, THEME.gold, 16, 150)
    }
  }
  view.particles.tick(ctx, dtMs)

  drawHint(ctx, state)

  if (view.paused) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '暂停', '按 P 继续 · R 重开')
  } else if (state.phase === 'over') {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '表演结束', '总分 ' + state.score + ' · 按 R 重新开始', THEME.gold)
  }

  if (view.helpOpen) {
    ctx.fillStyle = 'rgba(13,13,20,0.84)'
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H)
    roundRectPath(ctx, 36, 44, 448, 256, 12)
    ctx.fillStyle = THEME.panel
    ctx.fill()
    ctx.strokeStyle = THEME.panelEdge
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.font = 'bold 17px system-ui, sans-serif'
    ctx.fillStyle = THEME.text
    ctx.fillText('海豚跃浪 · 规则说明', LOGICAL_W / 2, 74)
    ctx.font = '600 15px system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillStyle = THEME.text
    for (let i = 0; i < HELP_LINES.length; i += 1) {
      ctx.fillText(HELP_LINES[i]!, 58, 104 + i * 26)
    }
  }

  roundRectPath(ctx, HELP_RECT.x, HELP_RECT.y, HELP_RECT.w, HELP_RECT.h, 6)
  ctx.fillStyle = view.helpOpen ? accent(0) : THEME.panel
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = view.helpOpen ? '#15151b' : THEME.text
  ctx.fillText('说明', HELP_RECT.x + HELP_RECT.w / 2, HELP_RECT.y + 16)
}
