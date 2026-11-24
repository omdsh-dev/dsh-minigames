/**
 * 螺栓分拣渲染层：工厂流水线风——自右向左滚动的传送带（滚轮反向旋转、
 * 左端红色斜纹漏检口）、环形螺母（颜色环体 + 内孔 + 内螺纹齿 + 选中金
 * 虚线圈）、四个螺栓工位（规格标签 M6/M10、孔径标尺、六角螺栓头色环、
 * 带螺纹的杆身、拧紧时六角螺母旋杆而下的动画 + 进度条、错配红闪）、
 * 得分 / 漏检 / 时间（关卡目标）HUD、飘字、粒子迸发、暂停与结算遮罩；
 * 渲染函数末尾最上层画「说明」按钮与 15px 大字帮助面板（任何阶段可
 * 开合，展开时遮住场面）。拖拽中的螺母以半透明幽灵跟随指针。
 */
import type { Bolt, Nut, ScrewSortState } from './logic.ts'
import {
  W, H, NUT_COLORS, HOLE_R, NUT_R, NUT_Y, BELT_LEFT, BELT_RIGHT, BELT_Y, BELT_H,
  SCREW_MS, FLOAT_MS, LEVEL_COUNT, LEVEL_TARGETS, HELP_BTN,
  STATION_W, STATION_Y, STATION_H, stationX, beltSpeed, levelOf,
} from './logic.ts'
import { THEME, createParticles, drawBackground, drawOverlay, glow, hudPair, noGlow, roundRectPath } from '../theme.ts'

const BELT_BODY = '#262636'
const BELT_EDGE = '#3a3a52'
const ROLLER = '#4a4a66'
const METAL = '#8a8aa0'
const METAL_DARK = '#454560'
const HUD_BAND = 'rgba(13,13,20,0.42)'

/** 帮助面板正文行（15px 大字，8 行完整规则）。 */
const HELP_LINES: readonly string[] = [
  '螺母随传送带从右侧送来，各有颜色与内径。',
  '点螺母选中，再点（或拖到）目标螺栓开始拧。',
  '颜色与内径都匹配才能拧上；拧紧需 0.8 秒，',
  '期间该螺栓占用，先处理别的螺母。',
  '拧错会弹回：扣 1 分，限时模式再扣 1.5 秒。',
  '迷惑螺母颜色相近但两属性都不合，放行别拧。',
  '真螺母漏到左端未处理 = 漏检，扣 2 分。',
  '空格按住加速 · P 暂停 · R 重开。',
]

/** 渲染层自有的粒子系统（每个画布一个实例）。 */
const particles = createParticles()

/**
 * 画传送带：带体、随带速向左行进的滚轮（辐条反向旋转）、左端红斜纹
 * 漏检口与标注。
 * @param ctx - 画布上下文。
 * @param speed - 当前带速 px/s。
 * @param t - 回合钟 ms。
 */
function drawBelt(ctx: CanvasRenderingContext2D, speed: number, t: number): void {
  ctx.fillStyle = BELT_BODY
  roundRectPath(ctx, BELT_LEFT, BELT_Y, BELT_RIGHT - BELT_LEFT, BELT_H, 8)
  ctx.fill()
  ctx.strokeStyle = BELT_EDGE
  ctx.lineWidth = 2
  ctx.stroke()
  // 滚轮：相位随带速推进（带向左走，滚轮随之左移并反向旋转）。
  const spacing = 26
  const travel = (t / 1000) * speed
  const phase = travel % spacing
  ctx.save()
  ctx.beginPath()
  ctx.rect(BELT_LEFT + 2, BELT_Y + 2, BELT_RIGHT - BELT_LEFT - 4, BELT_H - 4)
  ctx.clip()
  for (let x = BELT_RIGHT - phase; x > BELT_LEFT; x -= spacing) {
    const cy = BELT_Y + BELT_H / 2
    ctx.fillStyle = ROLLER
    ctx.beginPath()
    ctx.arc(x, cy, 6, 0, Math.PI * 2)
    ctx.fill()
    const ang = -(travel / 6) - x * 0.05
    ctx.strokeStyle = 'rgba(226,226,238,0.4)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(x - Math.cos(ang) * 4, cy - Math.sin(ang) * 4)
    ctx.lineTo(x + Math.cos(ang) * 4, cy + Math.sin(ang) * 4)
    ctx.stroke()
  }
  ctx.restore()
  // 左端漏检口：红色斜纹警示条。
  ctx.save()
  ctx.beginPath()
  ctx.rect(BELT_LEFT, BELT_Y, 14, BELT_H)
  ctx.clip()
  ctx.strokeStyle = 'rgba(247,118,142,0.8)'
  ctx.lineWidth = 5
  for (let k = -1; k < 4; k += 1) {
    ctx.beginPath()
    ctx.moveTo(BELT_LEFT + k * 10, BELT_Y + BELT_H + 2)
    ctx.lineTo(BELT_LEFT + k * 10 + 10, BELT_Y - 2)
    ctx.stroke()
  }
  ctx.restore()
  ctx.font = '600 11px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = THEME.bad
  ctx.fillText('← 漏检口', BELT_LEFT + 2, BELT_Y + BELT_H + 14)
}

/**
 * 画一颗环形螺母：颜色环体（辉光）+ 深色内孔 + 内螺纹齿 + 选中金虚线
 * 圈（迷惑件与真件画法完全一致——颜色相近本身就是考题）。
 * @param ctx - 画布上下文。
 * @param x - 中心逻辑 x。
 * @param y - 中心逻辑 y。
 * @param color - 填充色。
 * @param size - 内径档（决定孔半径）。
 * @param selected - 是否选中。
 */
function drawNutAt(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, size: 0 | 1, selected: boolean): void {
  const hole = HOLE_R[size]
  if (selected) {
    ctx.strokeStyle = THEME.gold
    ctx.lineWidth = 2
    ctx.setLineDash([5, 4])
    ctx.beginPath()
    ctx.arc(x, y, NUT_R + 6, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
  }
  glow(ctx, color, 10)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, NUT_R, 0, Math.PI * 2)
  ctx.fill()
  noGlow(ctx)
  ctx.fillStyle = '#15151b'
  ctx.beginPath()
  ctx.arc(x, y, hole, 0, Math.PI * 2)
  ctx.fill()
  // 内螺纹齿：孔缘 6 根短辐，提示孔径差异。
  ctx.strokeStyle = 'rgba(226,226,238,0.35)'
  ctx.lineWidth = 1.5
  for (let k = 0; k < 6; k += 1) {
    const a = (k * Math.PI) / 3
    ctx.beginPath()
    ctx.moveTo(x + Math.cos(a) * (hole - 1), y + Math.sin(a) * (hole - 1))
    ctx.lineTo(x + Math.cos(a) * (hole + 3.5), y + Math.sin(a) * (hole + 3.5))
    ctx.stroke()
  }
  ctx.strokeStyle = 'rgba(13,13,20,0.55)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(x, y, NUT_R, 0, Math.PI * 2)
  ctx.stroke()
}

/**
 * 画拧紧动画中的六角螺母：随进度沿杆身下行并旋转（六角外缘让旋转可
 * 见，孔径与拧上的螺母一致）。
 * @param ctx - 画布上下文。
 * @param x - 中心逻辑 x。
 * @param y - 中心逻辑 y。
 * @param color - 螺母颜色。
 * @param size - 内径档。
 * @param angle - 旋转角（弧度）。
 */
function drawScrewNut(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, size: 0 | 1, angle: number): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  glow(ctx, color, 8)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(0, 0, NUT_R - 2, 0, Math.PI * 2)
  ctx.fill()
  noGlow(ctx)
  ctx.fillStyle = '#15151b'
  ctx.beginPath()
  ctx.arc(0, 0, HOLE_R[size], 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(13,13,20,0.55)'
  ctx.lineWidth = 2
  ctx.beginPath()
  for (let k = 0; k < 6; k += 1) {
    const a = (k * Math.PI) / 3
    const px = Math.cos(a) * (NUT_R - 2)
    const py = Math.sin(a) * (NUT_R - 2)
    if (k === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.stroke()
  ctx.restore()
}

/**
 * 画一个螺栓工位：色边面板、M6/M10 规格标签、孔径标尺（卡尺夹缝宽度
 * 即内径）、六角头色环螺栓、螺纹杆身、底座、拧紧动画与进度条、错配
 * 红闪边框、已拧计数。
 * @param ctx - 画布上下文。
 * @param state - 当前状态。
 * @param i - 工位索引 0-3。
 */
function drawStation(ctx: CanvasRenderingContext2D, state: ScrewSortState, i: number): void {
  const bolt: Bolt = state.bolts[i]!
  const x0 = stationX(i)
  const cx = x0 + STATION_W / 2
  const color = NUT_COLORS[bolt.color]
  const flashing = bolt.flashUntil > state.t
  // 面板：错配红闪优先于本色描边。
  ctx.fillStyle = 'rgba(30,30,42,0.85)'
  roundRectPath(ctx, x0, STATION_Y, STATION_W, STATION_H, 10)
  ctx.fill()
  ctx.strokeStyle = flashing ? THEME.bad : color
  ctx.lineWidth = flashing ? 3.5 : 2.5
  ctx.stroke()
  // 规格标签：粗细 + 工位号（右端固定宽，避免与居中文本互相侵入）。
  ctx.font = 'bold 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = color
  ctx.fillText((bolt.size === 0 ? 'M6 细' : 'M10 粗') + ' · 螺栓 ' + (i + 1), cx, STATION_Y + 22)
  // 孔径标尺：两根竖尺夹住宽度 = 内孔直径的缝。
  const half = HOLE_R[bolt.size]
  const gy = STATION_Y + 34
  ctx.strokeStyle = flashing ? THEME.bad : THEME.textMuted
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(cx - half, gy - 6)
  ctx.lineTo(cx - half, gy + 8)
  ctx.moveTo(cx + half, gy - 6)
  ctx.lineTo(cx + half, gy + 8)
  ctx.moveTo(cx - half - 8, gy + 8)
  ctx.lineTo(cx + half + 8, gy + 8)
  ctx.stroke()
  // 螺栓：六角头（本色环心）+ 螺纹杆身（粗细可视化）+ 底座。
  const shaftTop = STATION_Y + 64
  const shaftBottom = STATION_Y + 236
  const shaftW = bolt.size === 0 ? 8 : 16
  ctx.fillStyle = METAL_DARK
  ctx.beginPath()
  for (let k = 0; k < 6; k += 1) {
    const a = (k * Math.PI) / 3 + Math.PI / 6
    const px = cx + Math.cos(a) * 16
    const py = shaftTop + 6 + Math.sin(a) * 16
    if (k === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = 2.5
  ctx.stroke()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, shaftTop + 6, 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = METAL
  ctx.fillRect(cx - shaftW / 2, shaftTop + 22, shaftW, shaftBottom - shaftTop - 22)
  ctx.strokeStyle = 'rgba(13,13,20,0.45)'
  ctx.lineWidth = 2
  for (let ty = shaftTop + 30; ty < shaftBottom; ty += 12) {
    ctx.beginPath()
    ctx.moveTo(cx - shaftW / 2 - 2, ty)
    ctx.lineTo(cx + shaftW / 2 + 2, ty)
    ctx.stroke()
  }
  ctx.fillStyle = METAL_DARK
  roundRectPath(ctx, cx - 24, shaftBottom, 48, 10, 3)
  ctx.fill()
  // 拧紧动画：螺母旋杆而下 + 底部进度条。
  if (bolt.busyUntil > state.t) {
    const p = 1 - (bolt.busyUntil - state.t) / SCREW_MS
    const ny = shaftTop + 26 + p * (shaftBottom - shaftTop - 46)
    drawScrewNut(ctx, cx, ny, NUT_COLORS[bolt.screwColor], bolt.screwSize, p * Math.PI * 6)
    ctx.fillStyle = 'rgba(13,13,20,0.6)'
    ctx.fillRect(x0 + 14, STATION_Y + STATION_H - 10, STATION_W - 28, 4)
    ctx.fillStyle = THEME.gold
    ctx.fillRect(x0 + 14, STATION_Y + STATION_H - 10, (STATION_W - 28) * p, 4)
  }
  // 已拧计数（定宽居中，不受数字位数影响跑偏）。
  ctx.font = 'bold 16px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = flashing ? THEME.bad : color
  ctx.fillText('已拧 ' + bolt.count, cx, STATION_Y + STATION_H - 20)
}

/**
 * 画飘字：金色得分 / 红色失误，随剩余寿命上浮渐隐。
 * @param ctx - 画布上下文。
 * @param state - 当前状态。
 */
function drawFloats(ctx: CanvasRenderingContext2D, state: ScrewSortState): void {
  ctx.save()
  ctx.textAlign = 'center'
  ctx.font = 'bold 15px system-ui, sans-serif'
  for (const fl of state.floats) {
    const k = Math.max(0, Math.min(1, fl.life / FLOAT_MS))
    ctx.globalAlpha = k
    ctx.fillStyle = fl.text === '漏检 -' + 2 || fl.text === '错配 -' + 1 ? THEME.bad : THEME.gold
    ctx.fillText(fl.text, Math.max(46, Math.min(W - 46, fl.x)), Math.max(44, Math.min(H - 16, fl.y)))
  }
  ctx.restore()
}

/**
 * 画 HUD：半透明深色条 + 分数（左）· 时间 / 关卡目标（居中）· 连击
 * （右锚 430）· 漏检（右锚 546），四组互不相交。
 * @param ctx - 画布上下文。
 * @param state - 当前状态。
 * @param level - 当前档位。
 */
function drawHud(ctx: CanvasRenderingContext2D, state: ScrewSortState, level: number): void {
  ctx.fillStyle = HUD_BAND
  roundRectPath(ctx, 4, 4, W - 8, 24, 8)
  ctx.fill()
  const hudY = 20
  // 居中：连续模式剩余秒 + 档位；关卡模式关号与目标进度。
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  if (state.mode === 'continuous') {
    const urgent = state.timeLeft <= 10_000
    ctx.fillStyle = urgent ? THEME.bad : THEME.text
    ctx.fillText('时间 ' + Math.ceil(state.timeLeft / 1000) + ' · L' + level, W / 2, hudY)
  } else {
    ctx.fillStyle = THEME.text
    const target = LEVEL_TARGETS[state.level - 1] ?? 0
    ctx.fillText('第 ' + state.level + '/' + LEVEL_COUNT + ' 关 ' + state.levelProgress + '/' + target, W / 2, hudY)
  }
  hudPair(ctx, 14, hudY, '分数', String(state.score))
  if (state.combo >= 2 && state.comboExpire > state.t) {
    ctx.font = 'bold 13px system-ui, sans-serif'
    ctx.textAlign = 'right'
    ctx.fillStyle = THEME.gold
    ctx.fillText('x' + state.combo + ' 连击', 430, hudY)
  }
  hudPair(ctx, W - 14, hudY, '漏检', String(state.missed), 'right', state.missed > 0 ? THEME.bad : THEME.text)
}

/**
 * 画「说明」按钮（60×24，始终可见、任何阶段可点开合）。
 * @param ctx - 画布上下文。
 * @param helpOpen - 帮助面板是否展开。
 */
function drawHelpButton(ctx: CanvasRenderingContext2D, helpOpen: boolean): void {
  ctx.fillStyle = THEME.panel
  roundRectPath(ctx, HELP_BTN.x, HELP_BTN.y, HELP_BTN.w, HELP_BTN.h, 6)
  ctx.fill()
  ctx.strokeStyle = helpOpen ? THEME.gold : THEME.panelEdge
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = helpOpen ? THEME.gold : THEME.text
  ctx.fillText(helpOpen ? '关闭' : '说明', HELP_BTN.x + HELP_BTN.w / 2, HELP_BTN.y + 16)
}

/**
 * 画帮助面板：480×336 居中面板、16px 标题、15px 正文 8 行完整规则。
 * @param ctx - 画布上下文。
 */
function drawHelpPanel(ctx: CanvasRenderingContext2D): void {
  const px = (W - 480) / 2
  const py = 118
  const pw = 480
  const ph = 336
  ctx.fillStyle = THEME.panel
  roundRectPath(ctx, px, py, pw, ph, 12)
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.font = 'bold 16px system-ui, sans-serif'
  ctx.fillStyle = THEME.text
  ctx.fillText('螺栓分拣 · 玩法', W / 2, py + 32)
  ctx.strokeStyle = 'rgba(52,52,74,0.9)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(px + 24, py + 44)
  ctx.lineTo(px + pw - 24, py + 44)
  ctx.stroke()
  ctx.font = '15px system-ui, sans-serif'
  ctx.fillStyle = THEME.text
  for (let i = 0; i < HELP_LINES.length; i += 1) {
    ctx.fillText(HELP_LINES[i]!, W / 2, py + 74 + i * 30)
  }
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('再点「关闭」或任意空白处收起', W / 2, py + ph - 14)
}

/**
 * 渲染一帧：背景、传送带、螺母（含拖拽幽灵）、工位、飘字、粒子、
 * HUD、遮罩，最后最上层画说明按钮与帮助面板。
 * @param ctx - 画布上下文。
 * @param state - 当前状态。
 * @param paused - 是否显示暂停遮罩。
 * @param helpOpen - 帮助面板是否展开。
 * @param drag - 拖拽指针的逻辑坐标（非拖拽为 null）。
 */
export function renderScrewSort(
  ctx: CanvasRenderingContext2D,
  state: ScrewSortState,
  paused: boolean,
  helpOpen: boolean,
  drag: { x: number, y: number } | null,
): void {
  drawBackground(ctx, W, H)
  const level = levelOf(state.mode, state.t, state.level)
  const speed = beltSpeed(level)
  drawBelt(ctx, speed, state.t)
  for (const nut of state.nuts) {
    drawNutAt(ctx, nut.x, NUT_Y, NUT_COLORS[nut.color], nut.size, nut.id === state.selected)
  }
  if (drag !== null && state.selected !== null) {
    const nut: Nut | undefined = state.nuts.find((n) => n.id === state.selected)
    if (nut !== undefined) {
      ctx.globalAlpha = 0.5
      drawNutAt(ctx, drag.x, drag.y, NUT_COLORS[nut.color], nut.size, false)
      ctx.globalAlpha = 1
    }
  }
  for (let i = 0; i < NUT_COLORS.length; i += 1) drawStation(ctx, state, i)
  drawFloats(ctx, state)
  // 消费逻辑层事件：拧对迸发本色粒子、错配 / 漏检红、迷惑件放行灰。
  for (const ev of state.events) {
    if (ev.type === 'screwed') particles.burst(ev.x, ev.y, NUT_COLORS[ev.color]!, 12, 150)
    else if (ev.type === 'mismatch' || ev.type === 'missed') particles.burst(ev.x, ev.y, THEME.bad, 10, 140)
    else if (ev.type === 'decoyPass') particles.burst(ev.x, ev.y, '#7a7a90', 6, 90)
  }
  particles.tick(ctx, paused ? 0 : 16)
  drawHud(ctx, state, level)
  if (paused) {
    drawOverlay(ctx, W, H, '暂停', '按 P 继续 · R 重开')
  } else if (state.over) {
    if (state.win) {
      drawOverlay(ctx, W, H, '全部完成', '五关拧毕 · 总分 ' + state.score + ' · 按 R 重开', THEME.good)
    } else {
      drawOverlay(ctx, W, H, '时间到', '得分 ' + state.score + ' · 漏检 ' + state.missed + ' · 按 R 重开', THEME.bad)
    }
  }
  // 最上层：说明按钮 + 帮助面板（渲染函数末尾，任何阶段可开合）。
  drawHelpButton(ctx, helpOpen)
  if (helpOpen) drawHelpPanel(ctx)
}
