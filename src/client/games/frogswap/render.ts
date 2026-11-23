/**
 * 青蛙过河渲染器：池塘水面（装饰波纹相位来自注入种子）、一排荷叶与
 * 带朝向眼睛的绿/黄青蛙、空位提示、可动蛙高亮、选中蛙的目标标记、
 * 死局警示横幅、步数/最优/效率 HUD、过关遮罩与「下一关」按钮。说明
 * 按钮与帮助面板画在渲染函数最末尾（最上层，任何遮罩都盖不住）。
 * 全部为纯 canvas 绘制，状态由 index.ts 传入。
 */
import { efficiency, isDeadlocked, legalTargets, optimalMoveCount } from './logic.ts'
import type { CellValue, FrogSwapState } from './logic.ts'
import { THEME, accent, drawBackground, drawOverlay, glow, hudPair, noGlow, roundRectPath } from '../theme.ts'

/** 逻辑画布宽度 px。 */
export const LOGICAL_W = 780
/** 逻辑画布高度 px。 */
export const LOGICAL_H = 440
/** 说明按钮矩形（右下角，60x24，画在渲染末尾最上层）。 */
export const HELP_BTN = { x: LOGICAL_W - 72, y: LOGICAL_H - 32, w: 60, h: 24 }
/** 帮助面板矩形（居中弹层，16px 大字，画在渲染末尾最上层）。 */
const HELP_PANEL = { x: 110, y: 146, w: 560, h: 254 }
/** 过关后的「下一关」按钮矩形。 */
const NEXT_BTN = { x: LOGICAL_W / 2 - 105, y: 296, w: 210, h: 38 }
/** 池塘水面矩形。 */
const POND = { x: 20, y: 70, w: LOGICAL_W - 40, h: 260 }
/** 荷叶行垂直中心。 */
const ROW_CY = 180
/** 荷叶最大尺寸与间距（关卡自适应：位数多时按宽收窄）。 */
const PAD_MAX = 64
const PAD_GAP = 10
/** HUD 各列左端 x（列间距 120，四列 + 右侧提示）。 */
const HUD_X = [20, 140, 260, 380]

/** 帮助面板文案（16px 大字，完整规则 + 易误解点）。 */
const HELP_LINES = [
  '玩法：绿蛙（朝右）只能向右走，黄蛙（朝左）只能向左走，不许后退',
  '· 每回合二选一：滑进相邻空位，或跳过恰好一只异色蛙落在其后的空位',
  '· 不可跳过两只蛙、不可跳空位或同色蛙；目标：两侧青蛙完全互换',
  '· 操作：先点一只高亮蛙，再点亮圈标记的空位落子',
  '· 死局（无可动蛙）时按 U 撤销几步再继续，不要硬闯',
  '· 最优步数 = 每侧蛙数 f 的 f×(f+2)：2+2 需 8 步，3+3 需 15 步',
  '· U：撤销 · R：重开 · P：暂停 · 过关后空格进下一关 · 再点「说明」关闭',
]

/** 命中区域：说明按钮 / 下一关按钮 / 荷叶位（蛙或空目标）。 */
export type HitRegion =
  | { kind: 'help' }
  | { kind: 'next' }
  | { kind: 'cell'; index: number }

/** 一次渲染所需的全部状态。 */
export interface FrogSwapView {
  state: FrogSwapState
  /** 选中的蛙下标（null 未选中）。 */
  selected: number | null
  /** 帮助面板开关。 */
  helpOpen: boolean
  paused: boolean
}

/**
 * 各荷叶位的椭圆矩形（水平居中，随位数自适应收窄）。
 * @param count - 荷叶位数（2f+1）。
 * @returns 每格的 {x,y,w,h}，h 略扁呈荷叶形。
 */
export function padRects(count: number): { x: number; y: number; w: number; h: number }[] {
  const pad = Math.min(PAD_MAX, Math.floor((POND.w - 80 - (count - 1) * PAD_GAP) / count))
  const gap = count > 1 ? PAD_GAP : 0
  const total = count * pad + (count - 1) * gap
  const x0 = (LOGICAL_W - total) / 2
  const out: { x: number; y: number; w: number; h: number }[] = []
  for (let i = 0; i < count; i += 1) {
    const x = x0 + i * (pad + gap)
    out.push({ x, y: ROW_CY - pad * 0.38, w: pad, h: pad * 0.76 })
  }
  return out
}

/**
 * 命中检测：坐标转说明按钮 / 下一关按钮 / 荷叶位。
 * @param x - 逻辑坐标 x。
 * @param y - 逻辑坐标 y。
 * @param view - 当前视图状态。
 * @returns 命中区域或 null。
 */
export function hitTest(x: number, y: number, view: FrogSwapView): HitRegion | null {
  const inRect = (r: { x: number; y: number; w: number; h: number }): boolean =>
    x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
  if (inRect(HELP_BTN)) return { kind: 'help' }
  if (view.state.won && inRect(NEXT_BTN)) return { kind: 'next' }
  const rects = padRects(view.state.cells.length)
  for (let i = 0; i < rects.length; i += 1) {
    if (inRect(rects[i]!)) return { kind: 'cell', index: i }
  }
  return null
}

/** 装饰水面波纹（相位来自注入种子的 deco 序列，确定性）。 */
function drawWater(ctx: CanvasRenderingContext2D, deco: number[]): void {
  ctx.save()
  ctx.beginPath()
  roundRectPath(ctx, POND.x, POND.y, POND.w, POND.h, 18)
  ctx.clip()
  const grad = ctx.createLinearGradient(0, POND.y, 0, POND.y + POND.h)
  grad.addColorStop(0, '#1b3a4b')
  grad.addColorStop(1, '#122836')
  ctx.fillStyle = grad
  ctx.fillRect(POND.x, POND.y, POND.w, POND.h)
  for (let line = 0; line < 3; line += 1) {
    const phase = (deco[line * 3] ?? 0) * Math.PI * 2
    const ly = POND.y + 46 + line * 74 + (deco[line * 3 + 1] ?? 0) * 18
    ctx.beginPath()
    for (let sx = POND.x + 12; sx <= POND.x + POND.w - 12; sx += 8) {
      const wy = ly + Math.sin(sx / 46 + phase) * 3.5
      if (sx === POND.x + 12) ctx.moveTo(sx, wy)
      else ctx.lineTo(sx, wy)
    }
    ctx.strokeStyle = 'rgba(125,207,255,0.16)'
    ctx.lineWidth = 2
    ctx.stroke()
  }
  ctx.restore()
}

/** 一片荷叶：绿色圆盘 + 十字叶脉；落点格亮边。 */
function drawPad(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  decoPhase: number,
  highlighted: boolean,
): void {
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  const rx = rect.w / 2
  const ry = rect.h / 2
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx, ry, 0, decoPhase * 0.2, Math.PI * 2)
  ctx.fillStyle = highlighted ? '#4d8f4a' : '#3d7a3c'
  ctx.fill()
  if (highlighted) {
    glow(ctx, accent(2), 8)
    ctx.fill()
    noGlow(ctx)
  }
  ctx.strokeStyle = 'rgba(158,206,106,0.4)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx, cy - ry * 0.9)
  ctx.lineTo(cx, cy + ry * 0.9)
  ctx.moveTo(cx - rx * 0.8, cy)
  ctx.lineTo(cx + rx * 0.8, cy)
  ctx.strokeStyle = 'rgba(22,46,24,0.5)'
  ctx.lineWidth = 1
  ctx.stroke()
}

/**
 * 一只青蛙：圆润身体 + 朝向侧的两只眼睛（绿朝右、黄朝左）。
 * @param ctx - 画布上下文。
 * @param rect - 所在荷叶矩形。
 * @param frog - 蛙色。
 * @param movable - 可动时描亮边。
 * @param selected - 选中时白边加粗。
 */
function drawFrog(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  frog: CellValue,
  movable: boolean,
  selected: boolean,
): void {
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  const r = rect.w * 0.32
  const dir = frog === 'G' ? 1 : -1
  const body = frog === 'G' ? '#79c96e' : '#e6c457'
  ctx.beginPath()
  ctx.ellipse(cx, cy, r, r * 0.86, 0, 0, Math.PI * 2)
  ctx.fillStyle = body
  glow(ctx, body, selected ? 14 : 7)
  ctx.fill()
  noGlow(ctx)
  if (movable || selected) {
    ctx.strokeStyle = selected ? THEME.text : accent(frog === 'G' ? 2 : 3)
    ctx.lineWidth = selected ? 2.5 : 1.6
    ctx.stroke()
  }
  // 背部斑纹。
  ctx.beginPath()
  ctx.ellipse(cx - dir * r * 0.25, cy, r * 0.55, r * 0.6, 0, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(20,32,18,0.35)'
  ctx.lineWidth = 1.2
  ctx.stroke()
  // 朝向侧的两只眼睛。
  for (const dy of [-1, 1]) {
    const ex = cx + dir * r * 0.62
    const ey = cy + dy * r * 0.42
    ctx.beginPath()
    ctx.arc(ex, ey, r * 0.24, 0, Math.PI * 2)
    ctx.fillStyle = '#f2f4e8'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(ex + dir * r * 0.08, ey, r * 0.11, 0, Math.PI * 2)
    ctx.fillStyle = '#1c2118'
    ctx.fill()
  }
}

/** 空荷叶的落点提示：虚线圆，选中蛙的目标加金点。 */
function drawTarget(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  strong: boolean,
): void {
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  const r = rect.w * 0.3
  ctx.beginPath()
  ctx.setLineDash([5, 4])
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.strokeStyle = strong ? THEME.gold : 'rgba(226,226,238,0.3)'
  ctx.lineWidth = strong ? 2 : 1.4
  ctx.stroke()
  ctx.setLineDash([])
  if (strong) {
    ctx.beginPath()
    ctx.arc(cx, cy, 3, 0, Math.PI * 2)
    ctx.fillStyle = THEME.gold
    ctx.fill()
  }
}

/**
 * 渲染一帧完整画面（说明按钮与帮助面板固定画在最上层）。
 * @param ctx - 逻辑坐标系下的画布上下文。
 * @param view - 视图状态。
 */
export function renderFrogSwap(ctx: CanvasRenderingContext2D, view: FrogSwapView): void {
  const s = view.state
  const dead = isDeadlocked(s)
  drawBackground(ctx, LOGICAL_W, LOGICAL_H)

  // HUD：关卡 / 步数 / 最优 / 效率（四列左对齐）+ 右侧操作提示。
  const labels = ['关卡 ', '步数 ', '最优 ', '效率 ']
  const opt = optimalMoveCount(s.frogCount)
  const values = [
    String(s.level) + '/5',
    String(s.moves),
    String(opt),
    String(efficiency(opt, s.moves)) + '%',
  ]
  for (let i = 0; i < 4; i += 1) {
    hudPair(ctx, HUD_X[i]!, 24, labels[i]!, values[i]!)
  }
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.fillStyle = THEME.textMuted
  ctx.textAlign = 'right'
  ctx.fillText('点蛙再点目标 · U 撤销', LOGICAL_W - 16, 24)

  // 池塘与荷叶行。
  drawWater(ctx, s.deco)
  const rects = padRects(s.cells.length)
  const targets = view.selected !== null ? legalTargets(s, view.selected) : []
  for (let i = 0; i < rects.length; i += 1) {
    const rect = rects[i]!
    const cell = s.cells[i]!
    const movable = cell !== null && legalTargets(s, i).length > 0
    const isTarget = targets.includes(i)
    drawPad(ctx, rect, s.deco[(i * 3 + 2) % s.deco.length] ?? 0, isTarget)
    if (cell === null) {
      drawTarget(ctx, rect, isTarget)
    } else {
      drawFrog(ctx, rect, cell, movable, view.selected === i)
    }
  }

  // 朝向图例：左绿右行、右黄左行（贴池塘下沿内侧）。
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = 'rgba(158,206,106,0.85)'
  ctx.fillText('绿蛙 →', POND.x + 16, POND.y + POND.h - 14)
  ctx.textAlign = 'right'
  ctx.fillStyle = 'rgba(230,196,87,0.85)'
  ctx.fillText('← 黄蛙', POND.x + POND.w - 16, POND.y + POND.h - 14)

  // 死局警示横幅（池塘内、荷叶下方居中）。
  if (dead) {
    ctx.textAlign = 'center'
    ctx.font = 'bold 15px system-ui, sans-serif'
    ctx.fillStyle = THEME.bad
    ctx.fillText('死局：没有可动的蛙了——按 U 撤销几步再试', LOGICAL_W / 2, 300)
  }

  // 过关遮罩与下一关按钮（说明按钮仍画在其上）。
  if (s.won) {
    drawOverlay(
      ctx, LOGICAL_W, LOGICAL_H, '互换完成',
      '步数 ' + s.moves + ' / 最优 ' + opt + ' · 空格或点按钮进下一关',
      THEME.gold,
    )
    roundRectPath(ctx, NEXT_BTN.x, NEXT_BTN.y, NEXT_BTN.w, NEXT_BTN.h, 9)
    ctx.fillStyle = accent(0)
    ctx.fill()
    ctx.textAlign = 'center'
    ctx.font = '600 15px system-ui, sans-serif'
    ctx.fillStyle = '#14141c'
    ctx.fillText(s.level >= 5 ? '再来一遍（空格）' : '下一关（空格）', LOGICAL_W / 2, NEXT_BTN.y + 25)
  } else if (view.paused) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '已暂停', '按 P 继续 · R 重开')
  }

  // 说明按钮 + 帮助面板：固定画在渲染函数最末尾（最上层，任何遮罩、
  // 棋盘与 HUD 都盖不住；暂停/过关/死局任何阶段都可开合）。
  const hb = HELP_BTN
  ctx.fillStyle = THEME.panel
  roundRectPath(ctx, hb.x, hb.y, hb.w, hb.h, 8)
  ctx.fill()
  ctx.strokeStyle = view.helpOpen ? accent(2) : THEME.panelEdge
  ctx.lineWidth = view.helpOpen ? 2 : 1
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.textAlign = 'center'
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.fillStyle = view.helpOpen ? accent(2) : THEME.textMuted
  ctx.fillText('说明', hb.x + hb.w / 2, hb.y + 16)
  if (view.helpOpen) {
    ctx.fillStyle = 'rgba(13,13,20,0.92)'
    roundRectPath(ctx, HELP_PANEL.x, HELP_PANEL.y, HELP_PANEL.w, HELP_PANEL.h, 10)
    ctx.fill()
    ctx.strokeStyle = THEME.panelEdge
    ctx.stroke()
    ctx.textAlign = 'left'
    ctx.font = '600 16px system-ui, sans-serif'
    HELP_LINES.forEach((line, i) => {
      ctx.fillStyle = i === 0 ? accent(2) : THEME.text
      ctx.fillText(line, HELP_PANEL.x + 18, HELP_PANEL.y + 32 + i * 27)
    })
  }
}
