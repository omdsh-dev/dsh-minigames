/**
 * 韦恩图谜题渲染：淡彩半透明交叠圆（重叠处自然加深）、数字卡池、区域
 * 高亮与谓词提示、错放红框、步数/限时 HUD、过关与暂停 overlay。全部
 * 纯 canvas 绘制，布局常量导出供 index 命中测试共用。
 */
import { allowedMasks, maskAtPoint, maskOf, type Predicate, type VennGameState } from './logic.ts'
import { accent, createParticles, drawBackground, drawOverlay, glow, hudPair, noGlow, roundRectPath, THEME, type ParticleSystem } from '../theme.ts'

/** 逻辑画布尺寸。 */
export const LOGICAL_W = 640
export const LOGICAL_H = 580
/** 韦恩图板区域（含圆外空白放置带）。 */
export const BOARD_TOP = 56
export const BOARD_BOTTOM = 424
/** 数字卡尺寸与池布局。 */
export const CARD_W = 44
export const CARD_H = 32
const CARD_GAP = 8
const POOL_PER_ROW = 8
const POOL_ROWS_Y = [448, 488]
const POOL_TOP = 434
const POOL_BOTTOM = 534
/** 圆外放置条。 */
const TRAY_Y = 410
/** HUD 与提示行。 */
const HUD_Y = 24
const HINT_Y = 48
const FOOTER_Y = 562

/** 池中第 i 张卡的矩形（i 为 pool 下标）。
 * @param i - 卡池下标。
 * @returns 矩形。
 */
export function cardRect(i: number): { x: number; y: number; w: number; h: number } {
  const row = Math.floor(i / POOL_PER_ROW)
  const col = i % POOL_PER_ROW
  const startX = (LOGICAL_W - (POOL_PER_ROW * CARD_W + (POOL_PER_ROW - 1) * CARD_GAP)) / 2
  return { x: startX + col * (CARD_W + CARD_GAP), y: POOL_ROWS_Y[row] ?? POOL_ROWS_Y[0]!, w: CARD_W, h: CARD_H }
}

/** 命中数字卡。
 * @param x - 逻辑 x。 @param y - 逻辑 y。 @param poolLen - 当前卡池长度。
 * @returns 卡池下标或 null。
 */
export function poolCardAt(x: number, y: number, poolLen: number): number | null {
  for (let i = poolLen - 1; i >= 0; i -= 1) {
    const r = cardRect(i)
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i
  }
  return null
}

/** 点是否在卡池面板内（用于「拖回卡池 = 取消」判定）。
 * @param y - 逻辑 y。
 * @returns 是否在池面板竖直范围。
 */
export function inPoolBand(y: number): boolean {
  return y >= POOL_TOP && y <= POOL_BOTTOM
}

/** 点是否在韦恩图放置区（含圆外空白）。 */
export function inBoard(y: number): boolean {
  return y >= BOARD_TOP && y < BOARD_BOTTOM
}

/** 每个区域掩码的展示锚点（已放置数字在此排开）。
 * @param mask - 区域掩码。 @param circleCount - 圆数量。
 * @returns 锚点坐标。
 */
export function anchorForMask(mask: number, circleCount: 2 | 3): { x: number; y: number } {
  if (circleCount === 2) {
    if (mask === 1) return { x: 195, y: 235 }
    if (mask === 2) return { x: 445, y: 235 }
    if (mask === 3) return { x: 320, y: 235 }
    return { x: 320, y: TRAY_Y }
  }
  if (mask === 1) return { x: 135, y: 235 }
  if (mask === 2) return { x: 322, y: 235 }
  if (mask === 4) return { x: 509, y: 235 }
  if (mask === 3) return { x: 248, y: 235 }
  if (mask === 6) return { x: 395, y: 235 }
  return { x: 320, y: TRAY_Y }
}

/** 圆 i 的谓词标签位置（圆顶上方，避开交叠区与 HUD）。
 * @param i - 圆下标。 @param circleCount - 圆数量。
 * @returns 标签锚点（文字底边中心）。
 */
export function circleLabelPos(i: number, circleCount: 2 | 3): { x: number; y: number } {
  if (circleCount === 2) {
    return i === 0 ? { x: 255, y: 75 } : { x: 385, y: 75 }
  }
  const xs = [175, 322, 469]
  return { x: xs[i] ?? 175, y: 108 }
}

/** 渲染附加视图状态（index 维护）。 */
export interface VennView {
  paused: boolean
  /** 当前指针逻辑坐标（null = 移出画布）。 */
  pointer: { x: number; y: number } | null
  /** 拿起的数字（null = 未拿）。 */
  held: number | null
  /** 错放红框（x,y 为放置点，ms 为剩余闪烁毫秒）。 */
  wrongFlash: { x: number; y: number; ms: number } | null
  /** 粒子系统（由 createVennParticles 创建）。 */
  particles: ParticleSystem
}

/** 本游戏粒子系统包装。 @returns 粒子系统。 */
export function createVennParticles(): ParticleSystem {
  return createParticles()
}

/** 常驻速览一行（画布内）。 */
const QUICK_HINT = '点数字卡拿起，再点韦恩图区域放置：须恰好满足该区每个圆、且不满足其余圆（圆外=全不满足）'

/** @param ms - 毫秒。 @returns 'm:ss' 文本。 */
function fmtTime(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

/** @param labels - 谓词标签数组。 @returns 顿号连接文本。 */
function joinLabels(labels: string[]): string {
  return labels.length === 0 ? '无' : labels.join('、')
}

/** 画一个数字卡。 */
function drawCard(
  ctx: CanvasRenderingContext2D, x: number, y: number, num: number, color: string, lifted: boolean,
): void {
  const w = CARD_W + (lifted ? 8 : 0)
  const h = CARD_H + (lifted ? 6 : 0)
  roundRectPath(ctx, x, y, w, h, 7)
  ctx.fillStyle = lifted ? '#2a2a3e' : THEME.panel
  glow(ctx, color, lifted ? 12 : 4)
  ctx.fill()
  noGlow(ctx)
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.font = 'bold 16px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = THEME.text
  ctx.fillText(String(num), x + w / 2, y + h / 2 + 1)
  ctx.textBaseline = 'alphabetic'
}

/** 主渲染入口：整帧绘制。
 * @param ctx - 画布上下文。 @param state - 游戏状态。 @param view - 视图状态。 @param dtMs - 帧毫秒（推进粒子）。
 */
export function renderVennGame(ctx: CanvasRenderingContext2D, state: VennGameState, view: VennView, dtMs: number): void {
  drawBackground(ctx, LOGICAL_W, LOGICAL_H)
  const playing = state.phase === 'playing' && !view.paused

  // —— HUD 行 ——
  hudPair(ctx, 24, HUD_Y, '关卡', state.level + '/' + 5)
  hudPair(ctx, 120, HUD_Y, '步数', String(state.steps))
  hudPair(ctx, 210, HUD_Y, '错误', String(state.wrong), 'left', state.wrong > 0 ? THEME.bad : THEME.text)
  hudPair(ctx, 300, HUD_Y, '分数', String(state.score))
  if (state.timeLimitMs !== null) {
    const remain = Math.max(0, state.timeLimitMs - state.elapsedMs)
    hudPair(ctx, 616, HUD_Y, '剩余', fmtTime(remain), 'right', remain < 30000 ? THEME.bad : THEME.gold)
  } else {
    hudPair(ctx, 616, HUD_Y, '限时', '无', 'right')
  }

  // —— 常驻速览一行 ——
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText(QUICK_HINT, LOGICAL_W / 2, HINT_Y)

  // —— 韦恩图圆 ——
  const hoverMask = view.pointer !== null && playing && inBoard(view.pointer.y)
    ? maskAtPoint(view.pointer.x, view.pointer.y, state.circles)
    : null
  for (let i = 0; i < state.circles.length; i += 1) {
    const c = state.circles[i]!
    const color = accent(i)
    const inHover = hoverMask !== null && (hoverMask & (1 << i)) !== 0
    ctx.beginPath()
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.globalAlpha = inHover ? 0.26 : 0.16
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = color
    ctx.lineWidth = inHover ? 3 : 2
    glow(ctx, color, inHover ? 12 : 6)
    ctx.stroke()
    noGlow(ctx)
  }
  // 圆谓词标签
  ctx.font = 'bold 14px system-ui, sans-serif'
  ctx.textAlign = 'center'
  for (let i = 0; i < state.predicates.length; i += 1) {
    const p: Predicate = state.predicates[i]!
    const pos = circleLabelPos(i, state.circleCount)
    ctx.fillStyle = accent(i)
    ctx.fillText(p.label, pos.x, pos.y)
  }
  // 拿牌悬停时提示目标区域合法性（绿=可放）
  if (view.held !== null && hoverMask !== null) {
    const ok = maskOf(view.held, state.predicates) === hoverMask
    const a = anchorForMask(hoverMask, state.circleCount)
    ctx.beginPath()
    ctx.arc(a.x, a.y, 22, 0, Math.PI * 2)
    ctx.strokeStyle = ok ? THEME.good : THEME.bad
    ctx.lineWidth = 2
    glow(ctx, ok ? THEME.good : THEME.bad, 10)
    ctx.stroke()
    noGlow(ctx)
  }

  // —— 圆外放置条 ——
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('圆外（全不满足）', 24, TRAY_Y + 4)
  const outside = state.placed.filter((pl) => pl.mask === 0)
  outside.forEach((pl, i) => {
    drawChip(ctx, 150 + i * 26, TRAY_Y - 6, pl.num)
  })
  if (outside.length === 0 && hoverMask === 0 && view.held !== null) {
    ctx.fillStyle = THEME.textMuted
    ctx.fillText('→ 数字放这里', 150, TRAY_Y + 4)
  }

  // —— 各区域已放置数字 ——
  ctx.textAlign = 'center'
  for (const m of allowedMasks(state.circleCount)) {
    if (m === 0) continue
    const nums = state.placed.filter((pl) => pl.mask === m).map((pl) => pl.num)
    const a = anchorForMask(m, state.circleCount)
    nums.forEach((n, i) => {
      const row = Math.floor(i / 4)
      const col = i % 4
      const rowLen = Math.min(4, nums.length - row * 4)
      drawChip(ctx, a.x + (col - (rowLen - 1) / 2) * 26, a.y - 8 + row * 22, n)
    })
  }

  // —— 悬停（未拿牌）显示区域谓词规则 ——
  if (view.held === null && hoverMask !== null && playing) {
    drawRuleTip(ctx, view.pointer!, hoverMask, state)
  }

  // —— 卡池 ——
  roundRectPath(ctx, 20, POOL_TOP, LOGICAL_W - 40, POOL_BOTTOM - POOL_TOP, 10)
  ctx.fillStyle = 'rgba(30,30,42,0.6)'
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  state.pool.forEach((num, i) => {
    if (num === view.held) return
    const r = cardRect(i)
    drawCard(ctx, r.x, r.y, num, accent(i % 8), false)
  })

  // —— 错放红框 ——
  if (view.wrongFlash !== null && view.wrongFlash.ms > 0) {
    const alpha = Math.min(1, view.wrongFlash.ms / 350)
    ctx.globalAlpha = alpha
    ctx.strokeStyle = THEME.bad
    ctx.lineWidth = 3
    roundRectPath(ctx, view.wrongFlash.x - 34, view.wrongFlash.y - 24, 68, 48, 8)
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  // —— 跟随指针的持牌 ——
  if (view.held !== null && view.pointer !== null) {
    drawCard(ctx, view.pointer.x - CARD_W / 2 - 4, view.pointer.y - CARD_H / 2 - 3, view.held, THEME.gold, true)
  }

  // —— 粒子与覆盖层 ——
  view.particles.tick(ctx, dtMs)
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('拖拽或点击均可 · R 重开 · P 暂停', LOGICAL_W / 2, FOOTER_Y)
  if (view.paused) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '暂停', '按 P 继续 · 按 R 重开')
  } else if (state.phase === 'clear') {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '第 ' + state.level + ' 关通过', '正在进入下一关…', THEME.good)
  } else if (state.phase === 'complete') {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '全部通关', '最终得分 ' + state.score + ' · 按 R 再来一局', THEME.gold)
  } else if (state.phase === 'failed') {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '时间到', '按 R 重开本局', THEME.bad)
  }
}

/** 区域内小数字（无卡片框，直接亮色数字）。 */
function drawChip(ctx: CanvasRenderingContext2D, x: number, y: number, num: number): void {
  ctx.font = 'bold 14px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = THEME.good
  glow(ctx, THEME.good, 5)
  ctx.fillText(String(num), x, y + 10)
  noGlow(ctx)
}

/** 悬停区域时展示该区域的满足/不满足谓词。 */
function drawRuleTip(ctx: CanvasRenderingContext2D, pt: { x: number; y: number }, mask: number, state: VennGameState): void {
  const yes: string[] = []
  const no: string[] = []
  state.predicates.forEach((p, i) => {
    if ((mask & (1 << i)) !== 0) yes.push(p.label)
    else no.push(p.label)
  })
  const line1 = '满足：' + joinLabels(yes)
  const line2 = '不满足：' + joinLabels(no)
  ctx.font = '600 12px system-ui, sans-serif'
  const w = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) + 24
  const h = 46
  let bx = pt.x + 14
  let by = pt.y + 12
  if (bx + w > LOGICAL_W - 8) bx = pt.x - w - 14
  if (by + h > BOARD_BOTTOM) by = pt.y - h - 10
  roundRectPath(ctx, bx, by, w, h, 8)
  ctx.fillStyle = 'rgba(13,13,20,0.86)'
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.textAlign = 'left'
  ctx.fillStyle = THEME.good
  ctx.fillText(line1, bx + 12, by + 19)
  ctx.fillStyle = THEME.bad
  ctx.fillText(line2, bx + 12, by + 36)
}
