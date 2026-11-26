/**
 * 层叠塔 TowerBuild 渲染：工地风画面——塔吊横梁与吊索摆动、方块木纹、
 * 联合重心投影虚线与基座支撑外的红色警示带、最危险界面红色高亮、
 * 倒塌散块物理动画、工地风旗；HUD 显示高度 / 重心偏差 / 稳定度 / 风力。
 * 纯绘制：所有坐标由 logic 的世界坐标（x=0 基座中心，y 负向上）换算。
 * 说明按钮与帮助面板画在整个渲染函数的最末尾，保证盖在一切之上。
 */
import { THEME, accent, glow, noGlow, roundRectPath, drawBackground, drawOverlay, hudPair } from '../theme.ts'
import {
  LEVELS, LEVEL_COUNT, BASE_W, BASE_H, BLOCK_H, HANG,
  pendingX, worstInterface, failReason, isComplete,
  type TowerBuildState,
} from './logic.ts'

/** 逻辑画布尺寸（关卡间不变，自适应交给 fitCanvas 变换）。 */
export const LOGICAL_W = 960
export const LOGICAL_H = 580

/** 一个矩形（逻辑坐标）。 */
export interface Rect { x: number, y: number, w: number, h: number }

/** 屏幕基准：地面线、塔中心、塔吊结构。 */
const GROUND_Y = 540
const TOWER_CX = 480
const RAIL_Y = 36
const POST_L = 250
const POST_R = 710
const FLAG_X = 830

/** 说明按钮（60x24，右下角；渲染最上层，点击命中由 index.ts 复用）。 */
export const HELP_BUTTON: Rect = { x: LOGICAL_W - 84, y: LOGICAL_H - 38, w: 60, h: 24 }

/** 世界 x → 屏幕 x。 */
function sx(worldX: number): number {
  return TOWER_CX + worldX
}

/** 世界 y → 屏幕 y（负向上）。 */
function sy(worldY: number): number {
  return GROUND_Y + worldY
}

/** 说明按钮是否被点中。 */
export function helpButtonHit(x: number, y: number): boolean {
  return x >= HELP_BUTTON.x && x < HELP_BUTTON.x + HELP_BUTTON.w && y >= HELP_BUTTON.y && y < HELP_BUTTON.y + HELP_BUTTON.h
}

/** 渲染选项（阶段之外的展示标志）。 */
export interface RenderOptions {
  /** 暂停（面板或 P 键）。 */
  paused: boolean
  /** 说明面板是否展开。 */
  helpOpen: boolean
}

/**
 * 整幅渲染：背景 → HUD → 工地结构 → 警示带 → 塔与基座 → 重心投影 →
 * 吊索与吊挂块 → 散块 → 风旗 → 粒子 → 暂停 / 过关 / 失败 overlay →
 * 说明按钮 → 帮助面板（最后两步永远最上层）。
 * @param ctx - 画布上下文（fitCanvas 已含逻辑坐标变换）。
 * @param state - 对局状态。
 * @param opts - 展示标志。
 * @param particles - 可选粒子系统（过关 / 放置成功时 burst）。
 * @param dtMs - 本帧毫秒（粒子推进用）。
 */
export function renderTower(
  ctx: CanvasRenderingContext2D,
  state: TowerBuildState,
  opts: RenderOptions,
  particles?: { tick(ctx: CanvasRenderingContext2D, dtMs: number): void },
  dtMs = 16,
): void {
  drawBackground(ctx, LOGICAL_W, LOGICAL_H)
  ctx.textBaseline = 'alphabetic'

  const level = LEVELS[state.level]!
  const n = state.blocks.length
  const worst = worstInterface(state)
  const comOff = Math.abs(state.comX) / (BASE_W / 2)

  // HUD 首行（y=26）：左三组左锚，右两组右锚，互不相交。
  hudPair(ctx, 24, 26, '关卡', (state.level + 1) + '/' + LEVEL_COUNT)
  hudPair(ctx, 160, 26, '高度', n + '/' + level.target)
  hudPair(ctx, 300, 26, '总分', String(state.score))
  hudPair(ctx, 700, 26, '稳定', worst.e.toFixed(2), 'right', worst.e > 0.8 ? THEME.bad : THEME.text)
  hudPair(ctx, 936, 26, '重心', Math.round(comOff * 100) + '%', 'right', comOff > 0.8 ? THEME.bad : THEME.text)

  drawGround(ctx)
  drawCrane(ctx)

  // 基座支撑外的红色警示带（左右各一条，高度到塔顶 + 一层）。
  const warnTop = Math.min(sy(-(BASE_H + (n + 1) * BLOCK_H)), RAIL_Y + 8)
  const half = BASE_W / 2
  ctx.fillStyle = 'rgba(247,118,142,0.10)'
  ctx.fillRect(sx(-half) - 26, warnTop, 26, GROUND_Y - warnTop)
  ctx.fillRect(sx(half), warnTop, 26, GROUND_Y - warnTop)

  drawBase(ctx)
  for (let k = 0; k < n; k += 1) {
    const b = state.blocks[k]!
    drawBlock(ctx, sx(b.cx) - b.w / 2, sy(-(BASE_H + (k + 1) * BLOCK_H)), b.w, BLOCK_H, k, worst.k === k && worst.e > 0.7)
  }

  drawComLine(ctx, state)

  if (state.phase === 'swing' || state.phase === 'cleared') {
    drawHanging(ctx, state)
  }

  drawDebris(ctx, state)
  drawFlag(ctx, state)

  particles?.tick(ctx, dtMs)

  if (state.phase === 'collapse') {
    ctx.font = 'bold 20px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = THEME.bad
    ctx.fillText(failReason(state) === 'miss' ? '脱钩坠落！' : '倒塌！', TOWER_CX, 80)
  }

  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('空格 / 点击 放块 · R 重开 · P 暂停 · H 说明', TOWER_CX, 562)

  if (opts.paused) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '暂停', '按 P 继续施工', THEME.gold)
  } else if (state.phase === 'cleared') {
    const last = state.level + 1 === LEVEL_COUNT
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '过关', last ? '封顶达成 · 五关全通' : '第 ' + (state.level + 1) + ' 关达成 · 即将开工下一关', THEME.good)
  } else if (state.phase === 'over') {
    if (isComplete(state)) {
      drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '全部通关', '总分 ' + state.score + ' · 空格再来一局', THEME.gold)
    } else {
      drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '游戏结束', '总分 ' + state.score + ' · 空格 / R 重开本关', THEME.bad)
    }
  }

  drawHelpButton(ctx, opts.helpOpen)
  if (opts.helpOpen) drawHelpPanel(ctx)
}

/** 地面线与地面填充。 */
function drawGround(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = 'rgba(226,226,238,0.08)'
  ctx.fillRect(0, GROUND_Y, LOGICAL_W, LOGICAL_H - GROUND_Y)
  ctx.strokeStyle = 'rgba(226,226,238,0.25)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(0, GROUND_Y)
  ctx.lineTo(LOGICAL_W, GROUND_Y)
  ctx.stroke()
}

/** 塔吊：两根立柱 + 横梁 + 斜撑。 */
function drawCrane(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 4
  for (const px of [POST_L, POST_R]) {
    ctx.beginPath()
    ctx.moveTo(px, RAIL_Y)
    ctx.lineTo(px, GROUND_Y)
    ctx.stroke()
  }
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.moveTo(POST_L - 30, RAIL_Y)
  ctx.lineTo(POST_R + 30, RAIL_Y)
  ctx.stroke()
  ctx.lineWidth = 2
  for (const px of [POST_L, POST_R]) {
    ctx.beginPath()
    ctx.moveTo(px, RAIL_Y)
    ctx.lineTo(px + (px === POST_L ? 26 : -26), RAIL_Y + 30)
    ctx.stroke()
  }
}

/** 基座：混凝土块 + 警示斜纹。 */
function drawBase(ctx: CanvasRenderingContext2D): void {
  const x = sx(-BASE_W / 2)
  const y = GROUND_Y - BASE_H
  ctx.fillStyle = '#2a2a3a'
  ctx.fillRect(x, y, BASE_W, BASE_H)
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 2
  ctx.strokeRect(x, y, BASE_W, BASE_H)
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y + BASE_H - 10, BASE_W, 10)
  ctx.clip()
  ctx.strokeStyle = 'rgba(224,175,104,0.5)'
  ctx.lineWidth = 4
  for (let i = -2; i < BASE_W / 12 + 2; i += 1) {
    ctx.beginPath()
    ctx.moveTo(x + i * 12, y + BASE_H + 4)
    ctx.lineTo(x + i * 12 + 10, y + BASE_H - 14)
    ctx.stroke()
  }
  ctx.restore()
}

/** 木纹方块：边框 + 两道纹理线；危险界面整块红色高亮。 */
function drawBlock(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, k: number, danger: boolean): void {
  const color = accent(k % 8 === 3 ? 4 : 2)
  roundRectPath(ctx, x, y, w, h, 3)
  ctx.fillStyle = danger ? '#5a3040' : '#4a4030'
  if (danger) glow(ctx, THEME.bad, 10)
  ctx.fill()
  noGlow(ctx)
  ctx.strokeStyle = danger ? THEME.bad : color
  ctx.lineWidth = danger ? 2 : 1.5
  ctx.stroke()
  ctx.strokeStyle = 'rgba(226,226,238,0.18)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x + 6, y + h * 0.35)
  ctx.lineTo(x + w - 6, y + h * 0.35)
  ctx.moveTo(x + 10, y + h * 0.7)
  ctx.lineTo(x + w - 10, y + h * 0.7)
  ctx.stroke()
}

/** 联合重心投影：金色竖虚线 + 地面三角标记。 */
function drawComLine(ctx: CanvasRenderingContext2D, state: TowerBuildState): void {
  const n = state.blocks.length
  if (n === 0) return
  const top = sy(-(BASE_H + n * BLOCK_H)) - 14
  const x = sx(state.comX)
  ctx.strokeStyle = THEME.gold
  ctx.lineWidth = 1.5
  ctx.setLineDash([6, 5])
  ctx.beginPath()
  ctx.moveTo(x, top)
  ctx.lineTo(x, GROUND_Y)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = THEME.gold
  ctx.beginPath()
  ctx.moveTo(x, GROUND_Y - 8)
  ctx.lineTo(x - 5, GROUND_Y + 2)
  ctx.lineTo(x + 5, GROUND_Y + 2)
  ctx.closePath()
  ctx.fill()
}

/** 吊挂块：滑车在横梁上，缆绳到吊钩，块随摆动相位微倾。 */
function drawHanging(ctx: CanvasRenderingContext2D, state: TowerBuildState): void {
  const x = pendingX(state)
  const n = state.blocks.length
  const hookY = Math.max(RAIL_Y + 10, sy(-(BASE_H + n * BLOCK_H)) - HANG)
  const p = state.pending
  const tilt = Math.cos(state.swingPhase) * 0.12
  // 滑车
  ctx.fillStyle = THEME.panelEdge
  roundRectPath(ctx, sx(x) - 14, RAIL_Y - 8, 28, 16, 4)
  ctx.fill()
  // 缆绳 + 吊钩
  ctx.strokeStyle = 'rgba(226,226,238,0.6)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(sx(x), RAIL_Y + 8)
  ctx.lineTo(sx(x), hookY - BLOCK_H)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(sx(x), hookY - BLOCK_H + 4, 4, Math.PI, 0)
  ctx.stroke()
  // 摆动中的块（绕吊点微旋转）
  ctx.save()
  ctx.translate(sx(x), hookY - BLOCK_H + 6)
  ctx.rotate(tilt)
  drawBlock(ctx, -p.w / 2, 0, p.w, BLOCK_H, n, false)
  ctx.restore()
}

/** 散块：旋转下落的木块。 */
function drawDebris(ctx: CanvasRenderingContext2D, state: TowerBuildState): void {
  for (const d of state.debris) {
    ctx.save()
    ctx.translate(sx(d.x), sy(d.y))
    ctx.rotate(d.rot)
    ctx.globalAlpha = 0.9
    drawBlock(ctx, -d.w / 2, -BLOCK_H / 2, d.w, BLOCK_H, 0, false)
    ctx.restore()
  }
  ctx.globalAlpha = 1
}

/** 工地风旗：无风垂旗；有风时旗面方向与长度随风力。 */
function drawFlag(ctx: CanvasRenderingContext2D, state: TowerBuildState): void {
  const strength = LEVELS[state.level]!.wind
  const topY = 64
  const botY = 128
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(FLAG_X, topY)
  ctx.lineTo(FLAG_X, botY)
  ctx.stroke()
  ctx.fillStyle = accent(4)
  ctx.beginPath()
  if (strength <= 0) {
    ctx.moveTo(FLAG_X, topY)
    ctx.lineTo(FLAG_X + 10, topY + 26)
    ctx.lineTo(FLAG_X, topY + 30)
  } else {
    const len = 18 + Math.abs(state.wind) / strength * 30
    const dir = state.wind >= 0 ? 1 : -1
    ctx.moveTo(FLAG_X, topY)
    ctx.lineTo(FLAG_X + dir * len, topY + 8)
    ctx.lineTo(FLAG_X, topY + 16)
  }
  ctx.closePath()
  ctx.fill()
}

/** 说明按钮（渲染末尾、最上层）。 */
function drawHelpButton(ctx: CanvasRenderingContext2D, open: boolean): void {
  roundRectPath(ctx, HELP_BUTTON.x, HELP_BUTTON.y, HELP_BUTTON.w, HELP_BUTTON.h, 6)
  ctx.fillStyle = open ? accent(0) : THEME.panel
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = open ? '#15151b' : THEME.text
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(open ? '关闭' : '说明', HELP_BUTTON.x + HELP_BUTTON.w / 2, HELP_BUTTON.y + 16)
}

const HELP_LINES = [
  '吊索吊着木块左右摆动，按空格（或点击）把它落在当前堆顶。',
  '每块宽度、重量与重心偏心都不同——落点决定塔稳不稳。',
  '落点与下方块重叠太小（脱钩）→ 块直接坠落，本关失败。',
  '金色虚线是全塔联合重心投影：越出基座支撑即整塔倾倒。',
  '每层界面的偏心比进入红色警戒（HUD「稳定」）会持续滑移，',
  '滑移累积超限，该界面以上整段倒塌——高而偏的塔活不长。',
  '五关目标 8→20 块；后两关起风，风会把塔推向滑移区，',
  '看风旗抢在下一次阵风前把重心拉回中线。R 重开 P 暂停。',
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
  ctx.fillText('层叠塔 规则说明', LOGICAL_W / 2, y + 40)
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
